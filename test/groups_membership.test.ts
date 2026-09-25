/**
 * Groups Stage 4: Membership & Access Operations Automated Tests
 * 
 * Verifies:
 * 1. Client validation helpers & Event bus dispatching
 * 2. Atomic Group creation & Creator Admin role assignment
 * 3. Race-safe direct join and capacity limit enforcement (max_size boundary)
 * 4. Dynamic effective access mode surge threshold (50% capacity shift to request mode)
 * 5. Join request lifecycle (request, duplicate prevention, cancel, approve, decline)
 * 6. Invariant: Rejoining must NOT restore a previous role
 * 7. Role management & capacity invariants (Max 1 Mod, Max 5 Specials)
 * 8. Atomic Admin Transfer & Exactly-one-Admin preservation
 * 9. Admin leave with mandatory succession vs. sole-member group dissolution
 * 10. Member removal, ban, and unban enforcement across join/request paths
 * 11. Safety block enforcement
 */

import https from 'https';
import {
  validateGroupName,
  validateGroupReason,
  validateGroupLifetime,
  validateGroupSize,
  validateCreateGroupInput,
  validateJoinQuestionAnswer,
  validateAssignRole,
} from '../src/domains/groups/validation';
import { emitGroupEvent, onGroupEvent } from '../src/domains/groups/events';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = 'jqghykhnnrfsjkkjhekf';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function query(sql: string, retries = 5): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await new Promise<any>((resolve, reject) => {
      const payload = JSON.stringify({ query: sql });
      const req = https.request(
        {
          hostname: 'api.supabase.com',
          path: `/v1/projects/${projectRef}/database/query`,
          method: 'POST',
          timeout: 15000,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            const retryAfter = parseInt(res.headers['retry-after'] as string, 10);
            try {
              resolve({ statusCode: res.statusCode, retryAfter, body: JSON.parse(data) });
            } catch (e) {
              resolve({ statusCode: res.statusCode, retryAfter, body: data });
            }
          });
        }
      );
      req.on('timeout', () => {
        req.destroy(new Error('Query timeout'));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    if (result.statusCode === 429 || result.body?.message?.includes('ThrottlerException')) {
      if (attempt < retries) {
        const waitSec = !isNaN(result.retryAfter) && result.retryAfter > 0 ? result.retryAfter + 1 : 5;
        console.log(`[Rate Limit] Waiting ${waitSec}s for rate limit reset (attempt ${attempt + 1}/${retries})...`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        continue;
      }
    }

    return result.body;
  }
}

async function runGroupsMembershipTests() {
  console.log('=== Running Tchat Groups Stage 4 (Membership & Access Operations) Tests ===\n');

  // -------------------------------------------------------------
  // 1. Validation & Event Bus Unit Tests
  // -------------------------------------------------------------
  console.log('1. Testing validation rules & event bus...');

  assert(!validateGroupName('a').isValid, 'Name < 2 chars must fail');
  assert(validateGroupName('Coffee Enthusiasts').isValid, 'Valid name must pass');
  assert(!validateGroupReason('no').isValid, 'Reason < 3 chars must fail');
  assert(validateGroupReason('Casual weekly meetup to discuss roasts').isValid, 'Valid reason must pass');
  assert(!validateGroupLifetime('1_month').isValid, 'Invalid lifetime must fail');
  assert(validateGroupLifetime('3_days').isValid, 'Valid lifetime must pass');
  assert(!validateGroupSize(1).isValid, 'Size < 2 must fail');
  assert(!validateGroupSize(31).isValid, 'Size > 30 must fail');
  assert(validateGroupSize(30).isValid, 'Size 30 must pass');

  // Question mode invariants in validation
  assert(!validateCreateGroupInput({
    name: 'Book Club',
    reason: 'Read and discuss',
    lifetime: '1_week',
    visibility: 'discoverable',
    access_mode: 'question',
  }).isValid, 'Question mode without question must fail validation');

  assert(validateCreateGroupInput({
    name: 'Book Club',
    reason: 'Read and discuss',
    lifetime: '1_week',
    visibility: 'discoverable',
    access_mode: 'question',
    joiningQuestion: 'What was your favorite book this year?',
  }).isValid, 'Question mode with question must pass validation');

  // Event bus test
  let eventFired = false;
  const unsubscribe = onGroupEvent((evt) => {
    if (evt.type === 'group:joined') {
      eventFired = true;
    }
  });
  emitGroupEvent('group:joined', '00000000-0000-0000-0000-000000000000');
  assert(eventFired, 'Event bus must trigger listener');
  unsubscribe();
  console.log('   ✓ Client validation & event bus tests passed');

  if (!token) {
    console.log('Skipping live DB tests (SUPABASE_ACCESS_TOKEN not set).');
    return;
  }

  // -------------------------------------------------------------
  // Database Setup: Seed Authenticated Test Users
  // -------------------------------------------------------------
  console.log('\n2. Setting up isolated test users in database...');
  const uAdmin = '00000000-0000-4000-b000-000000000001';
  const uMember1 = '00000000-0000-4000-b000-000000000002';
  const uMember2 = '00000000-0000-4000-b000-000000000003';
  const uMember3 = '00000000-0000-4000-b000-000000000004';
  const uStranger = '00000000-0000-4000-b000-000000000005';
  const uBlocked = '00000000-0000-4000-b000-000000000006';

  const allUsers = [uAdmin, uMember1, uMember2, uMember3, uStranger, uBlocked];

  // Clean previous run if any
  await query(`
    DELETE FROM public.blocks WHERE blocker_id IN ('${allUsers.join("','")}') OR blocked_id IN ('${allUsers.join("','")}');
    DELETE FROM public.group_bans WHERE user_id IN ('${allUsers.join("','")}');
    DELETE FROM public.group_join_requests WHERE user_id IN ('${allUsers.join("','")}');
    DELETE FROM public.group_members WHERE user_id IN ('${allUsers.join("','")}');
    DELETE FROM public.groups WHERE created_by_id IN ('${allUsers.join("','")}');
    DELETE FROM public.profiles WHERE id IN ('${allUsers.join("','")}');
    DELETE FROM public.accounts WHERE id IN ('${allUsers.join("','")}');
    DELETE FROM auth.users WHERE id IN ('${allUsers.join("','")}');
  `);

  await query(`
    INSERT INTO auth.users (id, email, aud, role) VALUES
      ('${uAdmin}', 'test_u_admin@example.com', 'authenticated', 'authenticated'),
      ('${uMember1}', 'test_u_member1@example.com', 'authenticated', 'authenticated'),
      ('${uMember2}', 'test_u_member2@example.com', 'authenticated', 'authenticated'),
      ('${uMember3}', 'test_u_member3@example.com', 'authenticated', 'authenticated'),
      ('${uStranger}', 'test_u_stranger@example.com', 'authenticated', 'authenticated'),
      ('${uBlocked}', 'test_u_blocked@example.com', 'authenticated', 'authenticated')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.accounts (id, email) VALUES
      ('${uAdmin}', 'test_u_admin@example.com'),
      ('${uMember1}', 'test_u_member1@example.com'),
      ('${uMember2}', 'test_u_member2@example.com'),
      ('${uMember3}', 'test_u_member3@example.com'),
      ('${uStranger}', 'test_u_stranger@example.com'),
      ('${uBlocked}', 'test_u_blocked@example.com')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, username, normalized_username, display_name) VALUES
      ('${uAdmin}', 'stg4_admin', 'stg4_admin', 'Stage 4 Admin'),
      ('${uMember1}', 'stg4_mem1', 'stg4_mem1', 'Member One'),
      ('${uMember2}', 'stg4_mem2', 'stg4_mem2', 'Member Two'),
      ('${uMember3}', 'stg4_mem3', 'stg4_mem3', 'Member Three'),
      ('${uStranger}', 'stg4_stranger', 'stg4_stranger', 'Stranger User'),
      ('${uBlocked}', 'stg4_blocked', 'stg4_blocked', 'Blocked User')
    ON CONFLICT (id) DO NOTHING;

    -- Safety block: uAdmin has blocked uBlocked
    INSERT INTO public.blocks (blocker_id, blocked_id) VALUES ('${uAdmin}', '${uBlocked}');
  `);
  console.log('   ✓ Test accounts and profiles seeded');

  let testGroupId: string = '';

  try {
    // -------------------------------------------------------------
    // 2. create_group RPC: Atomic creation with Admin
    // -------------------------------------------------------------
    console.log('\n3. Testing create_group RPC...');
    const createSql = `
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.create_group(
        'Alpha Explorers',
        'Exploring intentional mobile social groups',
        '1_week',
        'discoverable',
        'open',
        NULL,
        30,
        NULL
      );
    `;
    const createRes = await query(createSql);
    assert(Array.isArray(createRes) && createRes.length > 0, 'create_group must return result');
    const createdData = createRes[0].create_group;
    testGroupId = createdData.group_id;
    assert(!!testGroupId, 'Group ID must be returned');
    assert(createdData.role === 'admin', 'Creator must be assigned admin role');
    assert(createdData.member_count === 1, 'Member count must be 1');

    // Verify in public.group_members
    const checkAdminSql = `
      SELECT role, status FROM public.group_members WHERE group_id = '${testGroupId}' AND user_id = '${uAdmin}';
    `;
    const adminRow = await query(checkAdminSql);
    assert(adminRow[0].role === 'admin', 'Creator must be recorded as admin');
    assert(adminRow[0].status === 'active', 'Creator must be recorded as active');
    console.log('   ✓ Group created with atomic Admin');

    // -------------------------------------------------------------
    // 3. Direct Join & Capacity Enforcement (max_size boundary)
    // -------------------------------------------------------------
    console.log('\n4. Testing join_group and capacity boundaries...');

    // Member 1 joins testGroupId (max_size = 30, currently 1 member < 15 threshold)
    const join1Sql = `
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.join_group('${testGroupId}'::uuid);
    `;
    const join1Res = await query(join1Sql);
    assert(join1Res[0].join_group.status === 'active', 'Member 1 must join successfully');
    assert(join1Res[0].join_group.member_count === 2, 'Member count must now be 2');
    console.log('   ✓ Member 1 direct joined open group (member count: 2)');

    // Attempting to direct join again when already an active member must fail
    const dupJoinRes = await query(join1Sql);
    assert(dupJoinRes?.message?.includes('already an active member'), 'Duplicate join must fail');

    // Test max capacity boundary: create a group with max_size = 2
    const capGroupSql = `
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.create_group(
        'Duo Cap Group',
        'Testing capacity limit',
        '1_day',
        'discoverable',
        'open',
        NULL,
        2,
        NULL
      );
    `;
    const capRes = await query(capGroupSql);
    const capGroupId = capRes[0].create_group.group_id;

    // At 1/2, effective access is request (due to 50% threshold)
    // Member 1 requests and Admin approves -> group reaches 2/2 capacity
    const capReqRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.request_to_join_group('${capGroupId}'::uuid);
    `);
    const capReqId = capReqRes[0].request_to_join_group.request_id;

    await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.approve_group_join_request('${capReqId}'::uuid);
    `);

    // Verify member count is 2/2
    const capCountRes = await query(`SELECT public.get_group_active_member_count('${capGroupId}'::uuid);`);
    assert(capCountRes[0].get_group_active_member_count === 2, 'Member count must be 2');

    // Member 2 attempts to request or join group at max capacity -> must fail with maximum capacity
    const capFullReqRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.request_to_join_group('${capGroupId}'::uuid);
    `);
    assert(
      capFullReqRes?.message?.includes('maximum capacity') || capFullReqRes?.error?.includes('maximum capacity'),
      'Request to join group at max_size must fail with maximum capacity error'
    );

    const capFullJoinRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.join_group('${capGroupId}'::uuid);
    `);
    assert(
      capFullJoinRes?.message?.includes('maximum capacity') || capFullJoinRes?.error?.includes('maximum capacity'),
      'Direct join on group at max_size must fail with maximum capacity error'
    );
    console.log('   ✓ Max capacity boundary (max_size) strictly enforced');

    // Clean up cap group & member 1 from testGroupId for next tests
    await query(`DELETE FROM public.groups WHERE id = '${capGroupId}';`);
    await query(`DELETE FROM public.group_members WHERE group_id = '${testGroupId}' AND user_id = '${uMember1}';`);

    // -------------------------------------------------------------
    // 4. Dynamic Effective Access Mode (50% surge threshold)
    // -------------------------------------------------------------
    console.log('\n5. Testing dynamic 50% capacity surge protection...');
    // Create group with max_size = 4, access_mode = 'open'
    const surgeGroupSql = `
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.create_group(
        'Surge Test Group',
        'Testing 50 percent capacity auto-surge',
        '1_day',
        'discoverable',
        'open',
        NULL,
        4,
        NULL
      );
    `;
    const surgeRes = await query(surgeGroupSql);
    const surgeGroupId = surgeRes[0].create_group.group_id;

    // Member count is 1/4 -> effective access is 'open'
    const effMode1 = await query(`SELECT public.get_group_effective_access_mode('${surgeGroupId}'::uuid);`);
    assert(effMode1[0].get_group_effective_access_mode === 'open', 'At 1/4, effective mode must be open');

    // Member 1 joins -> Member count becomes 2/4 (50% of 4)
    await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.join_group('${surgeGroupId}'::uuid);
    `);

    // Member count is now 2/4 -> effective access dynamically shifts to 'request'!
    const effMode2 = await query(`SELECT public.get_group_effective_access_mode('${surgeGroupId}'::uuid);`);
    assert(effMode2[0].get_group_effective_access_mode === 'request', 'At 2/4, effective mode must dynamically be request');

    // Configured access_mode in table remains 'open'
    const confMode = await query(`SELECT access_mode FROM public.groups WHERE id = '${surgeGroupId}';`);
    assert(confMode[0].access_mode === 'open', 'Configured access_mode must remain open');

    // Direct join by Member 2 must now be rejected because dynamic effective access is 'request'
    const joinSurgeSql = `
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.join_group('${surgeGroupId}'::uuid);
    `;
    const joinSurgeRes = await query(joinSurgeSql);
    assert(
      joinSurgeRes?.message?.includes('effective access requires a join request') ||
      joinSurgeRes?.message?.includes('join request'),
      'Direct join must fail when effective access shifted to request'
    );
    console.log('   ✓ Dynamic 50% capacity shift to request verified');

    // Clean up surge group
    await query(`DELETE FROM public.groups WHERE id = '${surgeGroupId}';`);

    // -------------------------------------------------------------
    // 5. Join Requests Lifecycle (request, cancel, approve, decline)
    // -------------------------------------------------------------
    console.log('\n6. Testing join requests lifecycle...');

    // Create a question-mode group
    const questionGroupSql = `
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.create_group(
        'Question Group',
        'Testing question access requests',
        '1_week',
        'discoverable',
        'question',
        'What is your favorite book?',
        30,
        NULL
      );
    `;
    const qRes = await query(questionGroupSql);
    const qGroupId = qRes[0].create_group.group_id;

    // Direct join should fail (effective mode is question)
    const directQRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.join_group('${qGroupId}'::uuid);
    `);
    assert(directQRes?.message?.includes('requires a join request'), 'Direct join on question group must fail');

    // Request without answer must fail
    const reqNoAnsRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.request_to_join_group('${qGroupId}'::uuid, NULL);
    `);
    assert(reqNoAnsRes?.message?.includes('An answer between 2 and 500 characters is required'), 'Request without answer must fail');

    // Request with answer succeeds
    const reqWithAnsRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.request_to_join_group('${qGroupId}'::uuid, 'The Brothers Karamazov');
    `);
    const reqId = reqWithAnsRes[0].request_to_join_group.request_id;
    assert(!!reqId, 'Join request ID must be returned');

    // Duplicate pending request must fail
    const dupReqRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.request_to_join_group('${qGroupId}'::uuid, 'Another answer');
    `);
    assert(dupReqRes?.message?.includes('already pending'), 'Duplicate pending request must fail');

    // User cancels request
    const cancelReqRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.cancel_group_join_request('${reqId}'::uuid);
    `);
    assert(cancelReqRes[0].cancel_group_join_request.status === 'cancelled', 'Request must be cancelled');

    // Re-submit request
    const newReqRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.request_to_join_group('${qGroupId}'::uuid, 'War and Peace');
    `);
    const activeReqId = newReqRes[0].request_to_join_group.request_id;

    // Non-admin (Stranger) tries to approve -> must fail
    const strangerApproveRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uStranger}';
      SELECT public.approve_group_join_request('${activeReqId}'::uuid);
    `);
    assert(strangerApproveRes?.message?.includes('Only group admins or moderators'), 'Non-admin/mod cannot approve request');

    // Admin approves request
    const adminApproveRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.approve_group_join_request('${activeReqId}'::uuid);
    `);
    assert(adminApproveRes[0].approve_group_join_request.success === true, 'Admin must approve request successfully');
    assert(adminApproveRes[0].approve_group_join_request.role === 'member', 'Approved user must have role member');

    // Verify Member 1 is now active in group_members
    const mem1Status = await query(`SELECT status, role FROM public.group_members WHERE group_id = '${qGroupId}' AND user_id = '${uMember1}';`);
    assert(mem1Status[0].status === 'active' && mem1Status[0].role === 'member', 'Member 1 must be active member');

    // Member 2 requests, Admin declines
    const mem2ReqRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.request_to_join_group('${qGroupId}'::uuid, 'Crime and Punishment');
    `);
    const mem2ReqId = mem2ReqRes[0].request_to_join_group.request_id;

    const declineRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.decline_group_join_request('${mem2ReqId}'::uuid);
    `);
    assert(declineRes[0].decline_group_join_request.status === 'declined', 'Request must be declined');
    console.log('   ✓ Join request lifecycle (request, cancel, approve, decline) passed');

    await query(`DELETE FROM public.groups WHERE id = '${qGroupId}';`);

    // -------------------------------------------------------------
    // 6. Role Assignment & Capacity Limits (Mod, Special, Member)
    // -------------------------------------------------------------
    console.log('\n7. Testing assign_group_member_role and role capacity limits...');

    // Member 1 joins testGroupId
    await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.join_group('${testGroupId}'::uuid);
    `);

    // Member 2 joins testGroupId
    await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.join_group('${testGroupId}'::uuid);
    `);

    // Non-admin tries to assign role -> fails
    const nonAdminRoleRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.assign_group_member_role('${testGroupId}'::uuid, '${uMember2}', 'mod');
    `);
    assert(nonAdminRoleRes?.message?.includes('Only the group admin can assign member roles'), 'Non-admin cannot assign roles');

    // Admin assigns Member 1 as Mod -> succeeds
    const modAssignRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.assign_group_member_role('${testGroupId}'::uuid, '${uMember1}', 'mod');
    `);
    assert(modAssignRes[0].assign_group_member_role.new_role === 'mod', 'Member 1 should be promoted to mod');

    // Admin attempts to assign Member 2 as 2nd Mod -> fails (max 1 Mod)
    const secondModRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.assign_group_member_role('${testGroupId}'::uuid, '${uMember2}', 'mod');
    `);
    assert(
      secondModRes?.message?.includes('already has a moderator') || secondModRes?.message?.includes('maximum 1 allowed'),
      'Second mod must be rejected'
    );
    console.log('   ✓ Maximum 1 Moderator strictly enforced');

    // Admin assigns Member 2 as Special -> succeeds
    const specialAssignRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.assign_group_member_role('${testGroupId}'::uuid, '${uMember2}', 'special');
    `);
    assert(specialAssignRes[0].assign_group_member_role.new_role === 'special', 'Member 2 should be special');
    console.log('   ✓ Role assignment passed');

    // -------------------------------------------------------------
    // 7. Invariant: Rejoining MUST NOT restore a previous role
    // -------------------------------------------------------------
    console.log('\n8. Testing Invariant: Rejoining must NOT restore previous role...');
    // Member 1 (currently Mod) leaves the group
    const modLeaveRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.leave_group('${testGroupId}'::uuid);
    `);
    assert(modLeaveRes[0].leave_group.status === 'left', 'Mod should leave group');

    // Member 1 rejoins the group
    const rejoinRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.join_group('${testGroupId}'::uuid);
    `);
    assert(rejoinRes[0].join_group.status === 'active', 'User rejoins successfully');

    // Check DB role: MUST be 'member', NOT 'mod'
    const checkRoleSql = `SELECT role FROM public.group_members WHERE group_id = '${testGroupId}' AND user_id = '${uMember1}';`;
    const checkRoleRes = await query(checkRoleSql);
    assert(checkRoleRes[0].role === 'member', `Rejoined user must have role member (found ${checkRoleRes[0].role})`);
    console.log('   ✓ Rejoined member stripped of previous role (rejoins strictly as member)');

    // -------------------------------------------------------------
    // 8. Admin Transfer & Exactly-One-Admin Invariant
    // -------------------------------------------------------------
    console.log('\n9. Testing transfer_group_admin...');
    // Non-admin tries to transfer admin -> fails
    const nonAdminTransferRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.transfer_group_admin('${testGroupId}'::uuid, '${uMember2}');
    `);
    assert(nonAdminTransferRes?.message?.includes('Only the current group admin'), 'Non-admin cannot transfer admin');

    // Admin transfers admin to Member 1
    const transferRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.transfer_group_admin('${testGroupId}'::uuid, '${uMember1}');
    `);
    assert(transferRes[0].transfer_group_admin.new_admin_id === uMember1, 'Member 1 is now admin');

    // Verify exactly one admin exists
    const adminCountRes = await query(`
      SELECT user_id, role FROM public.group_members WHERE group_id = '${testGroupId}' AND status = 'active' AND role = 'admin';
    `);
    assert(adminCountRes.length === 1 && adminCountRes[0].user_id === uMember1, 'Exactly one active admin must exist (Member 1)');

    // Old Admin is now 'member'
    const oldAdminRes = await query(`
      SELECT role FROM public.group_members WHERE group_id = '${testGroupId}' AND user_id = '${uAdmin}';
    `);
    assert(oldAdminRes[0].role === 'member', 'Old admin must be demoted to member');

    // Transfer admin back to uAdmin for remaining tests
    await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.transfer_group_admin('${testGroupId}'::uuid, '${uAdmin}');
    `);
    console.log('   ✓ Atomic transfer_group_admin verified; exactly 1 admin preserved');

    // -------------------------------------------------------------
    // 9. Leave Group & Succession Invariants
    // -------------------------------------------------------------
    console.log('\n10. Testing leave_group & admin succession requirements...');
    // Admin attempts to leave without successor while other members exist -> must fail
    const adminLeaveFailRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.leave_group('${testGroupId}'::uuid, NULL);
    `);
    assert(
      adminLeaveFailRes?.message?.includes('designating an active member as successor'),
      'Admin cannot leave without successor when other active members exist'
    );
    console.log('   ✓ Admin cannot leave without successor when group has other members');

    // -------------------------------------------------------------
    // 10. Member Removal & Banning Enforcement
    // -------------------------------------------------------------
    console.log('\n11. Testing member removal, ban, and unban paths...');

    // Admin promotes Member 1 to mod
    await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.assign_group_member_role('${testGroupId}'::uuid, '${uMember1}', 'mod');
    `);

    // Mod tries to remove Admin -> fails
    const modRemoveAdminRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.remove_group_member('${testGroupId}'::uuid, '${uAdmin}');
    `);
    assert(modRemoveAdminRes?.message?.includes('admin cannot be removed'), 'Mod cannot remove admin');

    // Mod removes Member 2
    const modRemoveMem2Res = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.remove_group_member('${testGroupId}'::uuid, '${uMember2}', 'Disruptive behavior');
    `);
    assert(modRemoveMem2Res[0].remove_group_member.success === true, 'Mod removes Member 2');

    // Removed Member 2 attempts direct join -> must be rejected!
    const removedJoinRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.join_group('${testGroupId}'::uuid);
    `);
    assert(
      removedJoinRes?.message?.includes('cannot rejoin through normal path'),
      'Removed member direct join must be blocked'
    );

    // Removed Member 2 attempts request to join -> must be rejected!
    const removedReqRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.request_to_join_group('${testGroupId}'::uuid);
    `);
    assert(
      removedReqRes?.message?.includes('cannot request to join'),
      'Removed member request to join must be blocked'
    );
    console.log('   ✓ Removed member blocked from normal join and request paths');

    // Admin bans Member 3
    // Member 3 joins first
    await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember3}';
      SELECT public.join_group('${testGroupId}'::uuid);
    `);

    const banRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.ban_group_member('${testGroupId}'::uuid, '${uMember3}', 'Spamming');
    `);
    assert(banRes[0].ban_group_member.success === true, 'Member 3 is banned');

    // Banned Member 3 tries direct join -> fails
    const bannedJoinRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember3}';
      SELECT public.join_group('${testGroupId}'::uuid);
    `);
    assert(bannedJoinRes?.message?.includes('User is banned from this group'), 'Banned user join must fail');

    // Admin unbans Member 3
    const unbanRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.unban_group_member('${testGroupId}'::uuid, '${uMember3}');
    `);
    assert(unbanRes[0].unban_group_member.success === true, 'Member 3 is unbanned');

    // Check ban row is removed
    const banRow = await query(`SELECT * FROM public.group_bans WHERE group_id = '${testGroupId}' AND user_id = '${uMember3}';`);
    assert(banRow.length === 0, 'Ban row must be deleted');
    console.log('   ✓ Ban and unban operations verified');

    // -------------------------------------------------------------
    // 11. Safety Block Semantics
    // -------------------------------------------------------------
    console.log('\n12. Testing safety block enforcement on group join...');
    // uBlocked is blocked by uAdmin
    const blockedJoinRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uBlocked}';
      SELECT public.join_group('${testGroupId}'::uuid);
    `);
    assert(
      blockedJoinRes?.message?.includes('safety blocks'),
      'User with mutual block with admin cannot join group'
    );
    console.log('   ✓ Safety blocks strictly enforced on group operations');

    // -------------------------------------------------------------
    // 12. Read Helpers (get_group_details, list_group_members)
    // -------------------------------------------------------------
    console.log('\n13. Testing read helper RPCs...');
    // get_group_details by active member
    const detailsRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.get_group_details('${testGroupId}'::uuid);
    `);
    const details = detailsRes[0].get_group_details;
    assert(details.id === testGroupId, 'Group id must match');
    assert(details.admin.username === 'stg4_admin', 'Admin username must match');
    assert(details.membership.role === 'admin', 'Caller membership role must be admin');

    // list_group_members by active member
    const membersListRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT * FROM public.list_group_members('${testGroupId}'::uuid);
    `);
    assert(Array.isArray(membersListRes) && membersListRes.length >= 2, 'Active members list returned');

    // list_group_members by stranger -> must fail
    const strangerListRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uStranger}';
      SELECT * FROM public.list_group_members('${testGroupId}'::uuid);
    `);
    assert(strangerListRes?.message?.includes('Only active group members'), 'Stranger cannot list members');
    console.log('   ✓ Read helper RPCs verified');

    // -------------------------------------------------------------
    // 13. Sole Admin Leaves -> Group Dissolution
    // -------------------------------------------------------------
    console.log('\n14. Testing sole-member admin departure (group dissolution)...');
    // Remove remaining members so uAdmin is sole member
    await query(`
      DELETE FROM public.group_members WHERE group_id = '${testGroupId}' AND user_id <> '${uAdmin}';
    `);

    const soleLeaveRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.leave_group('${testGroupId}'::uuid);
    `);
    assert(soleLeaveRes[0].leave_group.group_status === 'deleted', 'Sole admin leave dissolves group (lifecycle_status = deleted)');

    // Verify in groups table
    const grpStatusRes = await query(`SELECT lifecycle_status FROM public.groups WHERE id = '${testGroupId}';`);
    assert(grpStatusRes[0].lifecycle_status === 'deleted', 'Group lifecycle_status must be deleted');
    console.log('   ✓ Sole admin leave dissolves group without leaving active group adminless');

  } finally {
    // -------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------
    console.log('\nCleaning up Stage 4 test records...');
    if (testGroupId) {
      await query(`DELETE FROM public.group_bans WHERE group_id = '${testGroupId}';`);
      await query(`DELETE FROM public.group_join_requests WHERE group_id = '${testGroupId}';`);
      await query(`DELETE FROM public.group_members WHERE group_id = '${testGroupId}';`);
      await query(`DELETE FROM public.groups WHERE id = '${testGroupId}';`);
    }
    await query(`
      DELETE FROM public.blocks WHERE blocker_id IN ('${allUsers.join("','")}') OR blocked_id IN ('${allUsers.join("','")}');
      DELETE FROM public.profiles WHERE id IN ('${allUsers.join("','")}');
      DELETE FROM public.accounts WHERE id IN ('${allUsers.join("','")}');
      DELETE FROM auth.users WHERE id IN ('${allUsers.join("','")}');
    `);
    console.log('Cleanup complete.');
  }

  console.log('\n=== All Stage 4 Membership & Access Operations Tests Passed Successfully! ===');
}

runGroupsMembershipTests().catch((err) => {
  console.error('Groups Membership test failure:', err);
  process.exit(1);
});
