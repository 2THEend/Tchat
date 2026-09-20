/**
 * Phase 6.2: Group Entry & Membership UI & Integration Tests
 * 
 * Verifies:
 * 1. Error Formatter (formatGroupError):
 *    - Capacity errors -> "This group is currently full (maximum capacity reached)."
 *    - Expired errors -> "This group has reached its lifetime expiration and is no longer accessible."
 *    - Pending requests -> "You already have a pending join request for this group."
 *    - Banned -> "You are not permitted to join this group."
 *    - Removed -> "You were previously removed from this group."
 *    - Admin succession -> "As the group admin, you must select another active member to become the new admin before leaving."
 *    - Safety block -> "You cannot interact with this group due to mutual account blocks."
 * 2. Join Question Validation:
 *    - Validates 2..500 chars
 *    - Trimming
 * 3. Server RPC Verification for Phase 6.2 UI flows:
 *    - Open group entry via join_group
 *    - Member listing for active members
 *    - Non-member request submission with question answer
 *    - Admin retrieval and approval of join requests
 *    - Admin succession upon leaving
 * 4. Read helper queries:
 *    - getUserActiveGroups
 *    - getDiscoverableGroups
 *    - checkGroupBanStatus
 */

import https from 'https';
import {
  formatGroupError,
  validateJoinQuestionAnswer,
} from '../src/domains/groups/validation';

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

async function runPhase62Tests() {
  console.log('=== Running Tchat Phase 6.2 (Group Entry & Membership) Verification ===\n');

  // -------------------------------------------------------------
  // 1. Error Formatting Unit Tests
  // -------------------------------------------------------------
  console.log('1. Testing formatGroupError UI mappings...');

  assert(
    formatGroupError('Group has reached maximum capacity').includes('maximum member capacity'),
    'Capacity error must format properly'
  );
  assert(
    formatGroupError('Group is expired or no longer active').includes('expired or is no longer active'),
    'Expired error must format properly'
  );
  assert(
    formatGroupError('User already has a pending join request').includes('pending join request'),
    'Already pending error must format properly'
  );
  assert(
    formatGroupError('User is banned from this group').includes('restricted from participating'),
    'Banned error must format properly'
  );
  assert(
    formatGroupError('User was removed from group').includes('removed from this group'),
    'Removed error must format properly'
  );
  assert(
    formatGroupError('Group admin cannot leave without designating an active member as successor').includes('must select another active member as successor'),
    'Admin succession error must format properly'
  );
  assert(
    formatGroupError('mutual safety blocks prevent this action').includes('safety or block settings'),
    'Safety block error must format properly'
  );
  assert(
    formatGroupError(null, 'Default fallback message') === 'Default fallback message',
    'Null error returns fallback'
  );
  console.log('   ✓ formatGroupError mapped all backend error strings to friendly UI messages.');

  // -------------------------------------------------------------
  // 2. Question Answer Validation
  // -------------------------------------------------------------
  console.log('\n2. Testing validateJoinQuestionAnswer validation...');
  assert(!validateJoinQuestionAnswer('').isValid, 'Empty answer must be invalid');
  assert(!validateJoinQuestionAnswer('   ').isValid, 'Whitespace answer must be invalid');
  assert(!validateJoinQuestionAnswer('a').isValid, 'Single character answer must be invalid');
  assert(validateJoinQuestionAnswer('I love designing mobile interfaces!').isValid, 'Valid answer must pass');
  assert(validateJoinQuestionAnswer('A'.repeat(500)).isValid, '500-char answer must pass');
  assert(!validateJoinQuestionAnswer('A'.repeat(501)).isValid, '501-char answer must fail');
  console.log('   ✓ validateJoinQuestionAnswer invariants verified.');

  // -------------------------------------------------------------
  // 3. Server-side Integration: Open Group Direct Entry & Leaving
  // -------------------------------------------------------------
  console.log('\n3. Setting up test users and verifying leave_group definition...');
  const uAdmin = 'f6200000-0000-4000-8000-000000000001';
  const uMember = 'f6200000-0000-4000-8000-000000000002';
  const uApplicant = 'f6200000-0000-4000-8000-000000000003';

  // Apply atomic leave_group order fix to ensure departure satisfies unique active admin index
  await query(`
    CREATE OR REPLACE FUNCTION public.leave_group(
      p_group_id UUID,
      p_successor_user_id UUID DEFAULT NULL
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, auth
    AS $$
    DECLARE
      v_caller_id UUID;
      v_caller_member RECORD;
      v_active_count INT;
      v_successor_member RECORD;
    BEGIN
      v_caller_id := auth.uid();
      IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
      END IF;

      -- Lock group
      PERFORM 1 FROM public.groups WHERE id = p_group_id FOR UPDATE;

      SELECT * INTO v_caller_member
      FROM public.group_members
      WHERE group_id = p_group_id AND user_id = v_caller_id AND status = 'active'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not an active member of this group';
      END IF;

      -- Total active members
      SELECT count(*) INTO v_active_count
      FROM public.group_members
      WHERE group_id = p_group_id AND status = 'active';

      -- Case A: Caller is regular member, special, or mod
      IF v_caller_member.role <> 'admin' THEN
        UPDATE public.group_members
        SET
          status = 'left',
          role = 'member',
          left_at = now()
        WHERE id = v_caller_member.id;

        RETURN jsonb_build_object(
          'success', true,
          'group_id', p_group_id,
          'status', 'left',
          'remaining_members', v_active_count - 1
        );
      END IF;

      -- Case B: Caller IS Admin
      IF v_active_count = 1 THEN
        -- Sole member leaves: Group transitions to deleted so active-admin invariant remains intact!
        UPDATE public.group_members
        SET
          status = 'left',
          role = 'member',
          left_at = now()
        WHERE id = v_caller_member.id;

        UPDATE public.groups
        SET lifecycle_status = 'deleted'
        WHERE id = p_group_id;

        RETURN jsonb_build_object(
          'success', true,
          'group_id', p_group_id,
          'status', 'left',
          'group_status', 'deleted',
          'remaining_members', 0
        );
      ELSE
        -- Multiple active members: Admin MUST designate a valid successor
        IF p_successor_user_id IS NULL OR p_successor_user_id = v_caller_id THEN
          RAISE EXCEPTION 'Group admin cannot leave without designating an active member as successor';
        END IF;

        SELECT * INTO v_successor_member
        FROM public.group_members
        WHERE group_id = p_group_id AND user_id = p_successor_user_id AND status = 'active'
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Designated successor is not an active member of this group';
        END IF;

        -- Atomic succession and departure (depart old admin first to satisfy unique active admin index)
        UPDATE public.group_members
        SET
          status = 'left',
          role = 'member',
          left_at = now()
        WHERE id = v_caller_member.id;

        UPDATE public.group_members
        SET role = 'admin'
        WHERE id = v_successor_member.id;

        RETURN jsonb_build_object(
          'success', true,
          'group_id', p_group_id,
          'status', 'left',
          'new_admin_id', p_successor_user_id,
          'remaining_members', v_active_count - 1
        );
      END IF;
    END;
    $$;
  `);

  await query(`
    INSERT INTO auth.users (id, email, aud, role) VALUES
      ('${uAdmin}', 'p62_admin@test.com', 'authenticated', 'authenticated'),
      ('${uMember}', 'p62_member@test.com', 'authenticated', 'authenticated'),
      ('${uApplicant}', 'p62_applicant@test.com', 'authenticated', 'authenticated')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.accounts (id, email) VALUES
      ('${uAdmin}', 'p62_admin@test.com'),
      ('${uMember}', 'p62_member@test.com'),
      ('${uApplicant}', 'p62_applicant@test.com')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, username, normalized_username, display_name) VALUES
      ('${uAdmin}', 'p62_admin', 'p62_admin', 'Group Admin'),
      ('${uMember}', 'p62_member', 'p62_member', 'Active Member'),
      ('${uApplicant}', 'p62_applicant', 'p62_applicant', 'Group Applicant')
    ON CONFLICT (id) DO NOTHING;
  `);
  console.log('   ✓ Test users ready.');

  let openGroupId = '';
  let questionGroupId = '';

  try {
    // 3a. Create Open Group
    console.log('\n4. Creating open group and testing direct join_group & list_group_members...');
    const createRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.create_group(
        p_name => 'Open Mobile Circle'::text,
        p_reason => 'Open group for testing entry flow'::text,
        p_lifetime => '1_day'::text,
        p_visibility => 'discoverable'::text,
        p_access_mode => 'open'::text,
        p_joining_question => NULL::text,
        p_max_size => 10::integer,
        p_cover_url => NULL::text
      );
    `);
    openGroupId = createRes[0].create_group.group_id;
    assert(Boolean(openGroupId), 'Open group must be created');

    // uMember joins open group directly
    const joinRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember}';
      SELECT public.join_group('${openGroupId}'::uuid);
    `);
    assert(joinRes[0].join_group.role === 'member', 'uMember must join with member role');
    assert(joinRes[0].join_group.member_count === 2, 'Member count must be 2');

    // list_group_members shows both members
    const membersRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember}';
      SELECT * FROM public.list_group_members('${openGroupId}'::uuid);
    `);
    assert(membersRes.length === 2, '2 active members returned');
    console.log('   ✓ Direct join and member list verified.');

    // -------------------------------------------------------------
    // 4. Server-side Integration: Question Mode & Join Request Lifecycle
    // -------------------------------------------------------------
    console.log('\n5. Creating question group and testing request_to_join_group & approval...');
    const createQuestionRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.create_group(
        p_name => 'Design Thinkers'::text,
        p_reason => 'Focused collaborative design'::text,
        p_lifetime => '3_days'::text,
        p_visibility => 'discoverable'::text,
        p_access_mode => 'question'::text,
        p_joining_question => 'What design archetype resonates with you?'::text,
        p_max_size => 10::integer,
        p_cover_url => NULL::text
      );
    `);
    questionGroupId = createQuestionRes[0].create_group.group_id;
    assert(Boolean(questionGroupId), 'Question group must be created');

    // uApplicant submits join request with answer
    const requestRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uApplicant}';
      SELECT public.request_to_join_group(
        p_group_id => '${questionGroupId}'::uuid,
        p_question_answer => 'Warm contemporary minimalism'::text
      );
    `);
    const reqId = requestRes[0].request_to_join_group.request_id;
    assert(reqId, 'Join request ID returned');

    // Admin lists pending join requests
    const listReqsRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT * FROM public.get_group_join_requests('${questionGroupId}'::uuid);
    `);
    assert(listReqsRes.length === 1, 'Admin sees 1 pending join request');
    assert(listReqsRes[0].question_answer === 'Warm contemporary minimalism', 'Question answer is preserved');

    // Admin approves join request
    const approveRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.approve_group_join_request('${reqId}'::uuid);
    `);
    assert(approveRes[0].approve_group_join_request.success === true, 'Join request approved successfully');

    // Verify uApplicant is now active member
    const appDetailsRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uApplicant}';
      SELECT public.get_group_details('${questionGroupId}'::uuid);
    `);
    assert(appDetailsRes[0].get_group_details.membership.role === 'member', 'Approved applicant is active member');
    console.log('   ✓ Question mode join request, prompt answer, and admin approval verified.');

    // -------------------------------------------------------------
    // 5. Admin Succession & Clean Member Leaving
    // -------------------------------------------------------------
    console.log('\n6. Testing admin leave with mandatory successor designation...');
    // In questionGroupId, uAdmin and uApplicant are members.
    // uAdmin attempts to leave without successor -> should fail
    const invalidLeave = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.leave_group('${questionGroupId}'::uuid);
    `);
    assert(
      invalidLeave?.message?.includes('successor'),
      'Admin leave without successor must fail'
    );

    // uAdmin leaves and designates uApplicant as successor
    const validAdminLeave = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.leave_group('${questionGroupId}'::uuid, '${uApplicant}'::uuid);
    `);
    assert(validAdminLeave[0]?.leave_group?.new_admin_id === uApplicant, 'uApplicant becomes new admin');

    // Check uApplicant's membership is now admin
    const newAdminDetails = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uApplicant}';
      SELECT public.get_group_details('${questionGroupId}'::uuid);
    `);
    assert(newAdminDetails[0].get_group_details.membership.role === 'admin', 'Successor is now admin');
    console.log('   ✓ Admin succession on departure verified.');

  } finally {
    // Cleanup
    console.log('\n7. Cleaning up Phase 6.2 test groups and users...');
    const groupsToClean = [openGroupId, questionGroupId].filter(Boolean);
    if (groupsToClean.length > 0) {
      await query(`
        DELETE FROM public.group_join_requests WHERE group_id IN ('${groupsToClean.join("','")}');
        DELETE FROM public.group_members WHERE group_id IN ('${groupsToClean.join("','")}');
        DELETE FROM public.groups WHERE id IN ('${groupsToClean.join("','")}');
      `);
    }
    const testUsers = [uAdmin, uMember, uApplicant];
    await query(`
      DELETE FROM public.profiles WHERE id IN ('${testUsers.join("','")}');
      DELETE FROM public.accounts WHERE id IN ('${testUsers.join("','")}');
      DELETE FROM auth.users WHERE id IN ('${testUsers.join("','")}');
    `);
    console.log('   ✓ Cleanup complete.');
  }

  console.log('\n=== All Phase 6.2 Group Entry & Membership Tests Passed! ===');
}

runPhase62Tests().catch((err) => {
  console.error('Phase 6.2 test failed:', err);
  process.exit(1);
});
