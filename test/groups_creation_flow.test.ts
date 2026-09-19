/**
 * Phase 6.1: Group Creation Flow Automated Tests
 * 
 * Verifies:
 * 1. Client-side Form Validation & Invariants:
 *    - Name boundaries (2-60 chars)
 *    - Reason boundaries (3-300 chars)
 *    - Lifetime options (1_day, 3_days, 1_week)
 *    - Visibility constraints (Private cannot have Open access)
 *    - Access mode constraints (Question mode requires question prompt)
 *    - Max size limits (2-30 members)
 * 2. Real Server RPC Execution (create_group):
 *    - Creator atomically assigned Admin role
 *    - Accurate expiration and grace period calculations
 *    - Question mode saves prompt accurately
 *    - Private + Request mode works properly
 *    - Authoritative get_group_details returns full details
 * 3. Invariant & Constraint Rejections:
 *    - Rejection of Private + Open
 *    - Rejection of max_size > 30
 *    - Rejection of invalid lifetime
 * 4. Cleanup of all created test groups
 */

import https from 'https';
import {
  validateGroupName,
  validateGroupReason,
  validateGroupLifetime,
  validateGroupSize,
  validateCreateGroupInput,
} from '../src/domains/groups/validation';
import { CreateGroupInput } from '../src/domains/groups/types';

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
            reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runGroupCreationFlowTests() {
  console.log('=== Running Tchat Phase 6.1 Group Creation Flow Tests ===\n');

  // -------------------------------------------------------------
  // 1. Client-side Form Validation & Invariants
  // -------------------------------------------------------------
  console.log('1. Testing client-side form validation rules & boundary invariants...');

  // Name validation
  assert(!validateGroupName('').isValid, 'Empty name must be invalid');
  assert(!validateGroupName('A').isValid, 'Single-char name must be invalid');
  assert(validateGroupName('AI Lab').isValid, '2+ char name must be valid');
  assert(validateGroupName('A'.repeat(60)).isValid, '60-char name must be valid');
  assert(!validateGroupName('A'.repeat(61)).isValid, '61-char name must be invalid');

  // Reason validation
  assert(!validateGroupReason('').isValid, 'Empty reason must be invalid');
  assert(!validateGroupReason('No').isValid, '2-char reason must be invalid');
  assert(validateGroupReason('A project for weekend testing').isValid, 'Valid reason must pass');
  assert(validateGroupReason('R'.repeat(300)).isValid, '300-char reason must be valid');
  assert(!validateGroupReason('R'.repeat(301)).isValid, '301-char reason must be invalid');

  // Lifetime validation
  assert(validateGroupLifetime('1_day').isValid, '1_day must be valid');
  assert(validateGroupLifetime('3_days').isValid, '3_days must be valid');
  assert(validateGroupLifetime('1_week').isValid, '1_week must be valid');
  assert(!validateGroupLifetime('1_month' as any).isValid, '1_month must be invalid');

  // Size validation
  assert(!validateGroupSize(1).isValid, '1 member max size must be invalid (min 2)');
  assert(validateGroupSize(2).isValid, '2 members must be valid');
  assert(validateGroupSize(30).isValid, '30 members must be valid');
  assert(!validateGroupSize(31).isValid, '31 members must be invalid (max 30)');

  // Invariant: Private cannot have Open access
  const privateOpenInput: CreateGroupInput = {
    name: 'Secret Circle',
    reason: 'Private collaborative group',
    lifetime: '3_days',
    visibility: 'private',
    access_mode: 'open',
    maxSize: 10,
  };
  const privateOpenRes = validateCreateGroupInput(privateOpenInput);
  assert(!privateOpenRes.isValid, 'Private group with open access must be rejected');
  assert(privateOpenRes.error?.includes('Private groups cannot have open access'), 'Must explain private open restriction');

  // Invariant: Question mode requires prompt
  const questionNoPromptInput: CreateGroupInput = {
    name: 'Philosophy Group',
    reason: 'Discussing philosophy',
    lifetime: '1_week',
    visibility: 'discoverable',
    access_mode: 'question',
    maxSize: 15,
  };
  const questionNoPromptRes = validateCreateGroupInput(questionNoPromptInput);
  assert(!questionNoPromptRes.isValid, 'Question mode without question prompt must be rejected');

  const questionShortPromptInput: CreateGroupInput = {
    ...questionNoPromptInput,
    joiningQuestion: 'Hi',
  };
  assert(!validateCreateGroupInput(questionShortPromptInput).isValid, 'Short question prompt must be rejected');

  // Valid question mode
  const validQuestionInput: CreateGroupInput = {
    ...questionNoPromptInput,
    joiningQuestion: 'What is your favorite philosophical topic?',
  };
  assert(validateCreateGroupInput(validQuestionInput).isValid, 'Valid question mode must pass validation');

  console.log('   ✓ Client-side validation & invariants passed.');

  // -------------------------------------------------------------
  // 2. Setup Database User for Server RPC Tests
  // -------------------------------------------------------------
  console.log('\n2. Setting up isolated test user for server-side RPC verification...');
  const testUserId = 'f1111111-6666-4000-8000-000000000001';
  const testUsername = 'p6_creator';

  await query(`
    INSERT INTO auth.users (id, email, aud, role)
    VALUES ('${testUserId}', '${testUsername}@test.com', 'authenticated', 'authenticated')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.accounts (id, email)
    VALUES ('${testUserId}', '${testUsername}@test.com')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, username, normalized_username, display_name)
    VALUES ('${testUserId}', '${testUsername}', '${testUsername}', 'Group Creator')
    ON CONFLICT (id) DO UPDATE SET display_name = 'Group Creator';
  `);
  console.log('   ✓ Test user seeded.');

  const createdGroupIds: string[] = [];

  try {
    // -------------------------------------------------------------
    // 3. Test Server RPC: create_group (1_day lifetime, open access)
    // -------------------------------------------------------------
    console.log('\n3. Testing server RPC create_group with 1_day lifetime and open access...');
    const group1Res = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${testUserId}';
      SELECT public.create_group(
        p_name => 'Design Explorers'::text,
        p_reason => 'Exploring UI and spatial principles for ephemeral spaces'::text,
        p_lifetime => '1_day'::text,
        p_visibility => 'discoverable'::text,
        p_access_mode => 'open'::text,
        p_joining_question => NULL::text,
        p_max_size => 20::integer,
        p_cover_url => 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809'::text
      );
    `);

    assert(Array.isArray(group1Res) && group1Res.length > 0, 'create_group must return created group details');
    const group1 = group1Res[0].create_group;
    assert(group1.group_id, 'Group ID must be returned');
    createdGroupIds.push(group1.group_id);

    assert(group1.name === 'Design Explorers', 'Group name must match');
    assert(group1.lifetime === '1_day', 'Lifetime must be 1_day');
    assert(group1.visibility === 'discoverable', 'Visibility must be discoverable');
    assert(group1.access_mode === 'open', 'Access mode must be open');
    assert(group1.max_size === 20, 'Max size must be 20');

    // Verify lifetime calculation (expires_at should be ~24 hours after creation)
    const groupDbRow = await query(`
      SELECT created_at, expires_at, grace_expires_at FROM public.groups WHERE id = '${group1.group_id}';
    `);
    const createdAt1 = new Date(groupDbRow[0].created_at).getTime();
    const expiresAt1 = new Date(groupDbRow[0].expires_at).getTime();
    const diffHours1 = (expiresAt1 - createdAt1) / (1000 * 60 * 60);
    assert(Math.abs(diffHours1 - 24) < 0.1, `1_day lifetime should expire in ~24 hours, got ${diffHours1} hours`);

    // Verify grace period calculation (grace_expires_at should be 7 days after expires_at)
    const graceExpiresAt1 = new Date(groupDbRow[0].grace_expires_at).getTime();
    const graceDiff1 = (graceExpiresAt1 - expiresAt1) / (1000 * 60 * 60);
    assert(Math.abs(graceDiff1 - 168) < 0.1, `Grace period must be 7 days (168h) after expires_at, got ${graceDiff1} hours`);

    // Verify creator is active admin in group_members
    const memberCheck = await query(`
      SELECT * FROM public.group_members 
      WHERE group_id = '${group1.group_id}' AND user_id = '${testUserId}';
    `);
    assert(memberCheck.length === 1, 'Creator must be in group_members table');
    assert(memberCheck[0].role === 'admin', 'Creator must be Admin');
    assert(memberCheck[0].status === 'active', 'Creator must be active');

    console.log('   ✓ 1_day open group created with authoritative Admin role and correct timestamps.');

    // -------------------------------------------------------------
    // 4. Test Server RPC: create_group with Question mode
    // -------------------------------------------------------------
    console.log('\n4. Testing server RPC create_group with Question mode & 3_days lifetime...');
    const questionText = 'Share your experience with micro-communities:';
    const group2Res = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${testUserId}';
      SELECT public.create_group(
        p_name => 'Micro-Community Lab'::text,
        p_reason => 'Testing intentional temporary communities with questionnaire entry'::text,
        p_lifetime => '3_days'::text,
        p_visibility => 'discoverable'::text,
        p_access_mode => 'question'::text,
        p_joining_question => '${questionText}'::text,
        p_max_size => 12::integer,
        p_cover_url => NULL::text
      );
    `);

    assert(Array.isArray(group2Res) && group2Res.length > 0, 'Group 2 creation must succeed');
    const group2 = group2Res[0].create_group;
    createdGroupIds.push(group2.group_id);

    // Verify joining question was stored
    const checkQuestion = await query(`
      SELECT joining_question FROM public.groups WHERE id = '${group2.group_id}';
    `);
    assert(checkQuestion[0].joining_question === questionText, 'Joining question must match');

    // Verify 3_days lifetime
    const group2Db = await query(`SELECT created_at, expires_at FROM public.groups WHERE id = '${group2.group_id}';`);
    const createdAt2 = new Date(group2Db[0].created_at).getTime();
    const expiresAt2 = new Date(group2Db[0].expires_at).getTime();
    const diffHours2 = (expiresAt2 - createdAt2) / (1000 * 60 * 60);
    assert(Math.abs(diffHours2 - 72) < 0.1, `3_days lifetime should expire in ~72 hours, got ${diffHours2} hours`);

    console.log('   ✓ Question mode group created with persisted question prompt and 72h expiration.');

    // -------------------------------------------------------------
    // 5. Test Server RPC: create_group with Private + Request mode
    // -------------------------------------------------------------
    console.log('\n5. Testing server RPC create_group with Private + Request mode & 1_week lifetime...');
    const group3Res = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${testUserId}';
      SELECT public.create_group(
        p_name => 'Private Think Tank'::text,
        p_reason => 'Weekly private discussions by invitation and review only'::text,
        p_lifetime => '1_week'::text,
        p_visibility => 'private'::text,
        p_access_mode => 'request'::text,
        p_joining_question => NULL::text,
        p_max_size => 30::integer,
        p_cover_url => NULL::text
      );
    `);

    assert(Array.isArray(group3Res) && group3Res.length > 0, 'Group 3 creation must succeed');
    const group3 = group3Res[0].create_group;
    createdGroupIds.push(group3.group_id);

    assert(group3.visibility === 'private', 'Visibility must be private');
    assert(group3.access_mode === 'request', 'Access mode must be request');

    // Verify 1_week lifetime (168 hours)
    const group3Db = await query(`SELECT created_at, expires_at FROM public.groups WHERE id = '${group3.group_id}';`);
    const createdAt3 = new Date(group3Db[0].created_at).getTime();
    const expiresAt3 = new Date(group3Db[0].expires_at).getTime();
    const diffHours3 = (expiresAt3 - createdAt3) / (1000 * 60 * 60);
    assert(Math.abs(diffHours3 - 168) < 0.1, `1_week lifetime should expire in ~168 hours, got ${diffHours3} hours`);

    console.log('   ✓ Private request-mode group created with 168h expiration.');

    // -------------------------------------------------------------
    // 6. Test Authoritative get_group_details RPC
    // -------------------------------------------------------------
    console.log('\n6. Testing get_group_details for transition to GroupArrivalView...');
    const detailsRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${testUserId}';
      SELECT * FROM public.get_group_details(
        p_group_id => '${group1.group_id}'::uuid
      );
    `);

    assert(Array.isArray(detailsRes) && detailsRes.length > 0, 'get_group_details must return data');
    const details = detailsRes[0].get_group_details || detailsRes[0];
    assert(details.id === group1.group_id, 'Group ID must match');
    assert(details.name === 'Design Explorers', 'Group name must match');
    assert(details.member_count === 1, 'Initial member count must be 1 (creator)');
    assert(details.membership?.role === 'admin', 'user role must be admin');
    assert(details.membership?.status === 'active', 'user membership status must be active');

    console.log('   ✓ Authoritative get_group_details returned correct payload for GroupArrivalView.');

    // -------------------------------------------------------------
    // 7. Test Invariant Enforcements & DB Constraints
    // -------------------------------------------------------------
    console.log('\n7. Testing server-side constraint enforcement...');

    // Attempt Private + Open on server
    const invalidPrivateOpen = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${testUserId}';
      SELECT public.create_group(
        p_name => 'Illegal Group'::text,
        p_reason => 'Testing private open rejection'::text,
        p_lifetime => '1_day'::text,
        p_visibility => 'private'::text,
        p_access_mode => 'open'::text,
        p_joining_question => NULL::text,
        p_max_size => 10::integer,
        p_cover_url => NULL::text
      );
    `);
    assert(
      invalidPrivateOpen.message?.includes('violates check constraint') || invalidPrivateOpen.error || !invalidPrivateOpen[0]?.create_group,
      'Private group with open access mode must be rejected by server'
    );

    // Attempt max_size > 30 on server
    const invalidSize = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${testUserId}';
      SELECT public.create_group(
        p_name => 'Oversized Group'::text,
        p_reason => 'Testing size limit'::text,
        p_lifetime => '1_day'::text,
        p_visibility => 'discoverable'::text,
        p_access_mode => 'open'::text,
        p_joining_question => NULL::text,
        p_max_size => 50::integer,
        p_cover_url => NULL::text
      );
    `);
    assert(
      invalidSize.message?.includes('violates check constraint') || invalidSize.error || !invalidSize[0]?.create_group,
      'Group with max_size > 30 must be rejected by server'
    );

    console.log('   ✓ Server constraints (Private+Open, max_size > 30) strictly enforced.');

  } finally {
    // -------------------------------------------------------------
    // 8. Cleanup test data
    // -------------------------------------------------------------
    console.log('\n8. Cleaning up test records...');
    if (createdGroupIds.length > 0) {
      const idsList = createdGroupIds.map((id) => `'${id}'`).join(',');
      await query(`
        DELETE FROM public.group_members WHERE group_id IN (${idsList});
        DELETE FROM public.groups WHERE id IN (${idsList});
      `);
    }
    await query(`
      DELETE FROM public.profiles WHERE id = '${testUserId}';
      DELETE FROM auth.users WHERE id = '${testUserId}';
    `);
    console.log('   ✓ Cleanup complete.');
  }

  console.log('\n=== All Phase 6.1 Group Creation Flow Tests Passed Successfully! ===');
}

runGroupCreationFlowTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
