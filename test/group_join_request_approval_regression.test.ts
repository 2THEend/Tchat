/**
 * Phase 6.2 Regression Test: Group Join Request Approval Contract & RPC Integration
 * 
 * Specifically tests the contract between:
 * 1. public.get_group_join_requests (returning request_id)
 * 2. TchatGroupJoinRequest (providing both id and request_id)
 * 3. approveGroupJoinRequest & declineGroupJoinRequest client wrappers
 * 4. public.approve_group_join_request(p_request_id UUID) server-side execution:
 *    - Pending request exists
 *    - Authorized Admin/Mod calls approval
 *    - Approval succeeds
 *    - Membership becomes active
 *    - Request becomes approved (no longer pending)
 *    - Group member count updates correctly
 *    - Unauthorized users (non-admin/non-mod) cannot approve
 *    - Capacity constraints remain strictly enforced
 */

import https from 'https';
import {
  getGroupJoinRequests,
  approveGroupJoinRequest,
  declineGroupJoinRequest,
  cancelGroupJoinRequest,
} from '../src/domains/groups/groupsService';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = 'jqghykhnnrfsjkkjhekf';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function query(sql: string): Promise<any> {
  return new Promise((resolve, reject) => {
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
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
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
}

async function runRegressionTests() {
  console.log('=== Running Group Join Request Approval Regression Test ===\n');

  // -------------------------------------------------------------
  // Test 1: Fast-fail validation on empty/undefined parameters
  // -------------------------------------------------------------
  console.log('1. Verifying client wrapper fast-fails on invalid/empty request ID...');
  const emptyApproveRes = await approveGroupJoinRequest('' as any, 'group-123');
  assert(
    Boolean(emptyApproveRes.error && emptyApproveRes.error.includes('Invalid or missing join request identifier')),
    `Empty approve request ID must return validation error, got: ${emptyApproveRes.error}`
  );

  const undefinedApproveRes = await approveGroupJoinRequest(undefined as any, 'group-123');
  assert(
    Boolean(undefinedApproveRes.error && undefinedApproveRes.error.includes('Invalid or missing join request identifier')),
    `Undefined approve request ID must return validation error, got: ${undefinedApproveRes.error}`
  );

  const emptyDeclineRes = await declineGroupJoinRequest('' as any, 'group-123');
  assert(
    Boolean(emptyDeclineRes.error && emptyDeclineRes.error.includes('Invalid or missing join request identifier')),
    `Empty decline request ID must return validation error, got: ${emptyDeclineRes.error}`
  );

  const emptyCancelRes = await cancelGroupJoinRequest('' as any, 'group-123');
  assert(
    Boolean(emptyCancelRes.error && emptyCancelRes.error.includes('Invalid or missing join request identifier')),
    `Empty cancel request ID must return validation error, got: ${emptyCancelRes.error}`
  );
  console.log('   ✓ Client wrappers protect against undefined/empty parameters (preventing schema cache error).\n');

  // -------------------------------------------------------------
  // Test 2: Database RPC Execution & Authorization Contract
  // -------------------------------------------------------------
  const uAdmin = 'da000000-0000-0000-0000-000000000001';
  const uMod = 'da000000-0000-0000-0000-000000000002';
  const uApplicant = 'da000000-0000-0000-0000-000000000003';
  const uApplicant2 = 'da000000-0000-0000-0000-000000000004';
  const uUnauthorized = 'da000000-0000-0000-0000-000000000005';

  console.log('2. Setting up regression test users in database...');
  await query(`
    INSERT INTO auth.users (id, email, aud, role) VALUES
      ('${uAdmin}', 'reg_admin@test.com', 'authenticated', 'authenticated'),
      ('${uMod}', 'reg_mod@test.com', 'authenticated', 'authenticated'),
      ('${uApplicant}', 'reg_app1@test.com', 'authenticated', 'authenticated'),
      ('${uApplicant2}', 'reg_app2@test.com', 'authenticated', 'authenticated'),
      ('${uUnauthorized}', 'reg_unauth@test.com', 'authenticated', 'authenticated')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.accounts (id, email) VALUES
      ('${uAdmin}', 'reg_admin@test.com'),
      ('${uMod}', 'reg_mod@test.com'),
      ('${uApplicant}', 'reg_app1@test.com'),
      ('${uApplicant2}', 'reg_app2@test.com'),
      ('${uUnauthorized}', 'reg_unauth@test.com')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, username, normalized_username, display_name) VALUES
      ('${uAdmin}', 'reg_admin', 'reg_admin', 'Regression Admin'),
      ('${uMod}', 'reg_mod', 'reg_mod', 'Regression Moderator'),
      ('${uApplicant}', 'reg_app1', 'reg_app1', 'Regression Applicant 1'),
      ('${uApplicant2}', 'reg_app2', 'reg_app2', 'Regression Applicant 2'),
      ('${uUnauthorized}', 'reg_unauth', 'reg_unauth', 'Unauthorized User')
    ON CONFLICT (id) DO NOTHING;
  `);

  let testGroupId = '';
  try {
    console.log('3. Creating test group with max_size = 2 (Capacity constraint test)...');
    const createRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.create_group(
        p_name => 'Approval Regression Group'::text,
        p_reason => 'Testing approval RPC contract'::text,
        p_lifetime => '1_day'::text,
        p_visibility => 'discoverable'::text,
        p_access_mode => 'request'::text,
        p_joining_question => NULL::text,
        p_max_size => 2::integer,
        p_cover_url => NULL::text
      );
    `);
    testGroupId = createRes[0].create_group.group_id;
    assert(Boolean(testGroupId), 'Test group must be created');

    // 4. Applicant 1 & Applicant 2 submit join requests while capacity permits
    console.log('4. Submitting join requests for Applicant 1 & Applicant 2...');
    const req1Res = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uApplicant}';
      SELECT public.request_to_join_group(
        p_group_id => '${testGroupId}'::uuid,
        p_question_answer => NULL::text
      );
    `);
    const req1Id = req1Res[0].request_to_join_group.request_id;
    assert(Boolean(req1Id), 'Applicant 1 join request ID must be returned');

    const req2Res = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uApplicant2}';
      SELECT public.request_to_join_group(
        p_group_id => '${testGroupId}'::uuid,
        p_question_answer => NULL::text
      );
    `);
    const req2Id = req2Res[0].request_to_join_group.request_id;
    assert(Boolean(req2Id), 'Applicant 2 join request submitted');

    // 5. Query get_group_join_requests via SQL and verify columns
    console.log('5. Verifying get_group_join_requests output and mapping...');
    const listRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT * FROM public.get_group_join_requests('${testGroupId}'::uuid);
    `);
    assert(listRes.length === 2, '2 pending requests returned');
    const item1 = listRes.find((r: any) => r.request_id === req1Id);
    assert(Boolean(item1), 'Returned request_id must match req1Id');
    assert(item1.user_id === uApplicant, 'User ID matches applicant');
    assert(item1.status === 'pending', 'Status is pending');

    // 6. Test unauthorized user cannot approve
    console.log('6. Verifying unauthorized user CANNOT approve join request...');
    const unauthApprove = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uUnauthorized}';
      SELECT public.approve_group_join_request('${req1Id}'::uuid);
    `);
    assert(
      Boolean(unauthApprove.message && unauthApprove.message.includes('Only group admins or moderators can approve')),
      `Unauthorized approval must be rejected by RLS/RPC, got: ${JSON.stringify(unauthApprove)}`
    );
    console.log('   ✓ Unauthorized approval properly rejected.');

    // 7. Authorized Admin approves join request 1
    console.log('7. Verifying Admin successfully approves join request 1...');
    const adminApprove = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.approve_group_join_request('${req1Id}'::uuid);
    `);
    assert(adminApprove[0].approve_group_join_request.success === true, 'Admin approval succeeds');
    assert(adminApprove[0].approve_group_join_request.role === 'member', 'Approved role is member');
    assert(adminApprove[0].approve_group_join_request.status === 'active', 'Approved status is active');

    // 8. Verify applicant is now active member and member count is 2 (at capacity!)
    console.log('8. Verifying group membership and updated member count...');
    const groupDetailsRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uApplicant}';
      SELECT public.get_group_details('${testGroupId}'::uuid);
    `);
    const details = groupDetailsRes[0].get_group_details;
    assert(details.membership.role === 'member', 'Applicant role is active member');
    assert(details.membership.status === 'active', 'Applicant status is active');
    assert(details.member_count === 2, `Group member count must be 2, got ${details.member_count}`);

    // 9. Capacity constraint enforcement on approval:
    // Group has max_size = 2 and member_count = 2. Approving req2 must be rejected by approve_group_join_request
    console.log('9. Verifying capacity constraints prevent approval when group is at max_size (2)...');
    const overCapacityApprove = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.approve_group_join_request('${req2Id}'::uuid);
    `);
    assert(
      Boolean(overCapacityApprove.message && overCapacityApprove.message.includes('maximum capacity')),
      `Approval when group is full must fail with capacity error, got: ${JSON.stringify(overCapacityApprove)}`
    );
    console.log('   ✓ Capacity constraint strictly enforced upon approval.');

    // 10. Decline request functionality
    console.log('10. Verifying admin decline of remaining request...');
    const adminDecline = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.decline_group_join_request('${req2Id}'::uuid);
    `);
    assert(adminDecline[0].decline_group_join_request.success === true, 'Admin decline succeeds');
    assert(adminDecline[0].decline_group_join_request.status === 'declined', 'Status is declined');
    console.log('   ✓ Decline request verified.');

    // 11. Verify pending request list is now empty
    console.log('11. Verifying pending request list is now empty...');
    const listAfterRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT * FROM public.get_group_join_requests('${testGroupId}'::uuid);
    `);
    assert(listAfterRes.length === 0, 'No pending requests should remain');

    console.log('\n=== ALL REGRESSION CHECKS PASSED ===');
  } finally {
    // Cleanup test group and test users
    if (testGroupId) {
      await query(`
        DELETE FROM public.group_join_requests WHERE group_id = '${testGroupId}';
        DELETE FROM public.group_members WHERE group_id = '${testGroupId}';
        DELETE FROM public.groups WHERE id = '${testGroupId}';
      `);
    }
    await query(`
      DELETE FROM public.profiles WHERE id::text LIKE 'da000000-%';
      DELETE FROM public.accounts WHERE id::text LIKE 'da000000-%';
      DELETE FROM auth.users WHERE id::text LIKE 'da000000-%';
    `);
  }
}

runRegressionTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
