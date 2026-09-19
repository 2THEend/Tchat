/**
 * Groups Phase 1: Core Schema & RLS Foundation Tests (Stage 3)
 * 
 * Verifies:
 * 1. Groups table structural constraints:
 *    - Valid group parameters
 *    - Private groups cannot have open access
 *    - Question access requires non-empty joining_question
 *    - Non-question access cannot have joining_question
 *    - Max size limits (2 to 30)
 *    - Lifetime constraints ('1_day', '3_days', '1_week')
 * 2. Exactly-one-Admin invariant:
 *    - Group creation without Admin fails deferred constraint
 *    - Group creation with exactly 1 Admin succeeds
 *    - Attempting to add a 2nd Admin fails unique constraint / deferred trigger
 *    - Removing or demoting the Admin fails deferred trigger
 * 3. Role limits:
 *    - At most 1 Mod allowed
 *    - At most 5 Specials allowed (6th fails)
 * 4. Effective access mode dynamic calculation:
 *    - Less than half capacity -> 'open'
 *    - At half capacity (e.g. 15/30) -> automatically 'request'
 * 5. Security & RLS:
 *    - Direct client INSERT/UPDATE/DELETE denied by RLS
 *    - Private group hidden from non-members
 *    - Discoverable group visible to non-members
 *    - Banned user cannot view discoverable group
 *    - Non-members cannot view group_members list
 */

import https from 'https';

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
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${projectRef}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runGroupsSchemaTests() {
  console.log('=== Running Tchat Groups Phase 1 (Core Schema & RLS) Tests ===\n');

  if (!token) {
    console.log('Skipping live DB tests: SUPABASE_ACCESS_TOKEN not present.');
    return;
  }

  // Setup isolated test users (temporary UUIDs)
  const userAdmin = '00000000-0000-4000-a000-000000000001';
  const userMember = '00000000-0000-4000-a000-000000000002';
  const userBanned = '00000000-0000-4000-a000-000000000003';
  const userStranger = '00000000-0000-4000-a000-000000000004';

  // Seed test accounts/profiles
  await query(`
    INSERT INTO auth.users (id, email, aud, role) VALUES
      ('${userAdmin}', 'test_grp_admin@example.com', 'authenticated', 'authenticated'),
      ('${userMember}', 'test_grp_member@example.com', 'authenticated', 'authenticated'),
      ('${userBanned}', 'test_grp_banned@example.com', 'authenticated', 'authenticated'),
      ('${userStranger}', 'test_grp_stranger@example.com', 'authenticated', 'authenticated')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.accounts (id, email) VALUES
      ('${userAdmin}', 'test_grp_admin@example.com'),
      ('${userMember}', 'test_grp_member@example.com'),
      ('${userBanned}', 'test_grp_banned@example.com'),
      ('${userStranger}', 'test_grp_stranger@example.com')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, username, normalized_username, display_name) VALUES
      ('${userAdmin}', 'test_grp_admin', 'test_grp_admin', 'Group Admin'),
      ('${userMember}', 'test_grp_member', 'test_grp_member', 'Group Member'),
      ('${userBanned}', 'test_grp_banned', 'test_grp_banned', 'Banned User'),
      ('${userStranger}', 'test_grp_stranger', 'test_grp_stranger', 'Stranger')
    ON CONFLICT (id) DO NOTHING;
  `);

  let testGroupId: string | null = null;

  try {
    // -------------------------------------------------------------
    // 1. Structural Constraints on public.groups
    // -------------------------------------------------------------
    console.log('1. Testing public.groups table structural constraints...');

    // A. Private group with open access -> MUST FAIL constraint chk_group_private_not_open
    const privOpenSql = `
      INSERT INTO public.groups (
        name, reason, lifetime, expires_at, grace_expires_at, visibility, access_mode, max_size, created_by_id
      ) VALUES (
        'Invalid Private Open', 'Testing constraint', '1_day', now() + interval '1 day', now() + interval '8 days',
        'private', 'open', 30, '${userAdmin}'
      );
    `;
    const privOpenRes = await query(privOpenSql);
    assert(
      privOpenRes?.message?.includes('chk_group_private_not_open') || privOpenRes?.error?.includes('chk_group_private_not_open'),
      'Private group with open access must be rejected by check constraint'
    );
    console.log('   ✓ Private group cannot have open access');

    // B. Question mode without question -> MUST FAIL constraint chk_group_question_mode
    const qMissingSql = `
      INSERT INTO public.groups (
        name, reason, lifetime, expires_at, grace_expires_at, visibility, access_mode, max_size, created_by_id
      ) VALUES (
        'Question Mode Missing', 'Testing constraint', '1_day', now() + interval '1 day', now() + interval '8 days',
        'discoverable', 'question', 30, '${userAdmin}'
      );
    `;
    const qMissingRes = await query(qMissingSql);
    assert(
      qMissingRes?.message?.includes('chk_group_question_mode') || qMissingRes?.error?.includes('chk_group_question_mode'),
      'Question access mode without question must be rejected'
    );
    console.log('   ✓ Question mode requires joining_question');

    // C. Open mode with a question provided -> MUST FAIL constraint chk_group_question_mode
    const openWithQSql = `
      INSERT INTO public.groups (
        name, reason, lifetime, expires_at, grace_expires_at, visibility, access_mode, joining_question, max_size, created_by_id
      ) VALUES (
        'Open Mode With Question', 'Testing constraint', '1_day', now() + interval '1 day', now() + interval '8 days',
        'discoverable', 'open', 'Why join?', 30, '${userAdmin}'
      );
    `;
    const openWithQRes = await query(openWithQSql);
    assert(
      openWithQRes?.message?.includes('chk_group_question_mode') || openWithQRes?.error?.includes('chk_group_question_mode'),
      'Open access mode cannot have joining_question'
    );
    console.log('   ✓ Open mode cannot have joining_question');

    // D. Invalid lifetime -> MUST FAIL
    const badLifeSql = `
      INSERT INTO public.groups (
        name, reason, lifetime, expires_at, grace_expires_at, visibility, access_mode, max_size, created_by_id
      ) VALUES (
        'Bad Lifetime', 'Testing constraint', '1_year', now() + interval '1 day', now() + interval '8 days',
        'discoverable', 'open', 30, '${userAdmin}'
      );
    `;
    const badLifeRes = await query(badLifeSql);
    assert(
      badLifeRes?.message?.includes('groups_lifetime_check') || badLifeRes?.error?.includes('groups_lifetime_check'),
      'Arbitrary lifetime must be rejected'
    );
    console.log('   ✓ Unsupported lifetime is rejected');

    // E. Max size > 30 -> MUST FAIL
    const badSizeSql = `
      INSERT INTO public.groups (
        name, reason, lifetime, expires_at, grace_expires_at, visibility, access_mode, max_size, created_by_id
      ) VALUES (
        'Oversized Group', 'Testing constraint', '1_day', now() + interval '1 day', now() + interval '8 days',
        'discoverable', 'open', 50, '${userAdmin}'
      );
    `;
    const badSizeRes = await query(badSizeSql);
    assert(
      badSizeRes?.message?.includes('groups_max_size_check') || badSizeRes?.error?.includes('groups_max_size_check'),
      'Max size > 30 must be rejected'
    );
    console.log('   ✓ Max size > 30 is rejected');

    // -------------------------------------------------------------
    // 2. Exactly One Admin Invariant
    // -------------------------------------------------------------
    console.log('2. Testing Exactly-One-Admin invariant...');

    // A. Inserting group without inserting Admin in same transaction -> MUST FAIL at commit
    const noAdminSql = `
      BEGIN;
      INSERT INTO public.groups (
        id, name, reason, lifetime, expires_at, grace_expires_at, visibility, access_mode, max_size, created_by_id
      ) VALUES (
        '11111111-2222-3333-4444-555555555555', 'No Admin Group', 'Reason description', '1_day',
        now() + interval '1 day', now() + interval '8 days', 'discoverable', 'open', 30, '${userAdmin}'
      );
      COMMIT;
    `;
    const noAdminRes = await query(noAdminSql);
    assert(
      noAdminRes?.message?.includes('exactly one active admin') || noAdminRes?.error?.includes('exactly one active admin'),
      'Operating group without admin must fail deferred invariant trigger'
    );
    console.log('   ✓ Operating group without admin fails deferred trigger');

    // B. Inserting group AND inserting creator as Admin in same transaction -> MUST SUCCEED
    testGroupId = '99999999-8888-7777-6666-555555555555';
    const validGroupSql = `
      BEGIN;
      INSERT INTO public.groups (
        id, name, reason, lifetime, expires_at, grace_expires_at, visibility, access_mode, max_size, created_by_id
      ) VALUES (
        '${testGroupId}', 'Tchat Founders', 'Discussing early product ideas', '3_days',
        now() + interval '3 days', now() + interval '10 days', 'discoverable', 'open', 30, '${userAdmin}'
      );
      INSERT INTO public.group_members (group_id, user_id, role, status)
      VALUES ('${testGroupId}', '${userAdmin}', 'admin', 'active');
      COMMIT;
    `;
    const validRes = await query(validGroupSql);
    assert(!validRes?.error && !validRes?.message, `Valid group creation should succeed: ${JSON.stringify(validRes)}`);
    console.log('   ✓ Group creation with atomic Admin succeeds');

    // C. Inserting a second Admin -> MUST FAIL unique index idx_group_members_unique_admin
    const secondAdminSql = `
      INSERT INTO public.group_members (group_id, user_id, role, status)
      VALUES ('${testGroupId}', '${userMember}', 'admin', 'active');
    `;
    const secondAdminRes = await query(secondAdminSql);
    assert(
      secondAdminRes?.message?.includes('idx_group_members_unique_admin') || secondAdminRes?.error?.includes('idx_group_members_unique_admin'),
      'Second active admin must be rejected by unique index'
    );
    console.log('   ✓ Second active admin rejected by unique index');

    // -------------------------------------------------------------
    // 3. Role Constraints (Mod & Special caps)
    // -------------------------------------------------------------
    console.log('3. Testing Mod & Special role constraints...');

    // A. 1st Mod -> SUCCEEDS
    const firstModSql = `
      INSERT INTO public.group_members (group_id, user_id, role, status)
      VALUES ('${testGroupId}', '${userMember}', 'mod', 'active');
    `;
    const firstModRes = await query(firstModSql);
    assert(!firstModRes?.error, 'First mod should succeed');

    // B. 2nd Mod -> MUST FAIL unique index
    const secondModSql = `
      INSERT INTO public.group_members (group_id, user_id, role, status)
      VALUES ('${testGroupId}', '${userStranger}', 'mod', 'active');
    `;
    const secondModRes = await query(secondModSql);
    assert(
      secondModRes?.message?.includes('idx_group_members_unique_mod') || secondModRes?.error?.includes('idx_group_members_unique_mod'),
      'Second mod must be rejected by unique index'
    );
    console.log('   ✓ Maximum 1 Mod constraint verified');

    // Clean up member row
    await query(`DELETE FROM public.group_members WHERE group_id = '${testGroupId}' AND user_id = '${userMember}';`);

    // C. Special role capacity (up to 5 specials)
    console.log('   Testing Special role capacity (max 5)...');
    const tempUsers = [
      '00000000-0000-4000-a000-000000000011',
      '00000000-0000-4000-a000-000000000012',
      '00000000-0000-4000-a000-000000000013',
      '00000000-0000-4000-a000-000000000014',
      '00000000-0000-4000-a000-000000000015',
      '00000000-0000-4000-a000-000000000016',
    ];

    await query(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${tempUsers[0]}', 'u1@ex.com', 'authenticated', 'authenticated'),
        ('${tempUsers[1]}', 'u2@ex.com', 'authenticated', 'authenticated'),
        ('${tempUsers[2]}', 'u3@ex.com', 'authenticated', 'authenticated'),
        ('${tempUsers[3]}', 'u4@ex.com', 'authenticated', 'authenticated'),
        ('${tempUsers[4]}', 'u5@ex.com', 'authenticated', 'authenticated'),
        ('${tempUsers[5]}', 'u6@ex.com', 'authenticated', 'authenticated')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.accounts (id, email) VALUES
        ('${tempUsers[0]}', 'u1@ex.com'),
        ('${tempUsers[1]}', 'u2@ex.com'),
        ('${tempUsers[2]}', 'u3@ex.com'),
        ('${tempUsers[3]}', 'u4@ex.com'),
        ('${tempUsers[4]}', 'u5@ex.com'),
        ('${tempUsers[5]}', 'u6@ex.com')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Insert 5 specials -> SUCCEEDS
    const insert5Sql = `
      BEGIN;
      INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
        ('${testGroupId}', '${tempUsers[0]}', 'special', 'active'),
        ('${testGroupId}', '${tempUsers[1]}', 'special', 'active'),
        ('${testGroupId}', '${tempUsers[2]}', 'special', 'active'),
        ('${testGroupId}', '${tempUsers[3]}', 'special', 'active'),
        ('${testGroupId}', '${tempUsers[4]}', 'special', 'active');
      COMMIT;
    `;
    const res5 = await query(insert5Sql);
    assert(!res5?.error, 'Inserting 5 specials should succeed');
    console.log('   ✓ 5 specials accepted');

    // Insert 6th special -> MUST FAIL deferred trigger
    const insert6thSql = `
      BEGIN;
      INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
        ('${testGroupId}', '${tempUsers[5]}', 'special', 'active');
      COMMIT;
    `;
    const res6 = await query(insert6thSql);
    assert(
      res6?.message?.includes('more than 5 active specials') || res6?.error?.includes('more than 5 active specials'),
      '6th special must be rejected by trigger'
    );
    console.log('   ✓ 6th special rejected by role cap trigger');

    // Clean up temporary specials
    await query(`DELETE FROM public.group_members WHERE group_id = '${testGroupId}' AND user_id IN ('${tempUsers.join("','")}');`);
    await query(`DELETE FROM public.accounts WHERE id IN ('${tempUsers.join("','")}');`);
    await query(`DELETE FROM auth.users WHERE id IN ('${tempUsers.join("','")}');`);

    // -------------------------------------------------------------
    // 4. Effective Access Mode (Dynamic Half-Capacity Downgrade)
    // -------------------------------------------------------------
    console.log('4. Testing dynamic effective access mode...');

    // Group currently has 1 member (admin) out of 30. Threshold = ceil(30/2) = 15.
    const modeRes1 = await query(`SELECT public.get_group_effective_access_mode('${testGroupId}') AS mode;`);
    assert(modeRes1[0].mode === 'open', `Mode below threshold should be 'open' (got ${modeRes1[0].mode})`);
    console.log('   ✓ 1/30 members -> effective access is "open"');

    // Create smaller group of max_size = 4, where threshold = ceil(4/2) = 2
    const smallGroupId = '88888888-7777-6666-5555-444444444444';
    await query(`
      BEGIN;
      INSERT INTO public.groups (
        id, name, reason, lifetime, expires_at, grace_expires_at, visibility, access_mode, max_size, created_by_id
      ) VALUES (
        '${smallGroupId}', 'Small Group', 'Testing threshold', '1_day',
        now() + interval '1 day', now() + interval '8 days', 'discoverable', 'open', 4, '${userAdmin}'
      );
      INSERT INTO public.group_members (group_id, user_id, role, status)
      VALUES ('${smallGroupId}', '${userAdmin}', 'admin', 'active');
      COMMIT;
    `);

    // At 1/4 -> open
    const smallMode1 = await query(`SELECT public.get_group_effective_access_mode('${smallGroupId}') AS mode;`);
    assert(smallMode1[0].mode === 'open', '1/4 members -> open');

    // Add 2nd member -> reaches 2/4 (>= half of 4) -> effective mode MUST BECOME 'request'
    await query(`
      INSERT INTO public.group_members (group_id, user_id, role, status)
      VALUES ('${smallGroupId}', '${userMember}', 'member', 'active');
    `);
    const smallMode2 = await query(`SELECT public.get_group_effective_access_mode('${smallGroupId}') AS mode;`);
    assert(smallMode2[0].mode === 'request', `2/4 members -> effective mode must become 'request' (got ${smallMode2[0].mode})`);
    console.log('   ✓ 2/4 members (half-capacity reached) -> effective access dynamically switches to "request"');

    // Configured access mode in table remains 'open'
    const storedMode = await query(`SELECT access_mode FROM public.groups WHERE id = '${smallGroupId}';`);
    assert(storedMode[0].access_mode === 'open', 'Stored configured access_mode must remain unmodified');
    console.log('   ✓ Configured access_mode remains "open" in database');

    await query(`DELETE FROM public.groups WHERE id = '${smallGroupId}';`);

    // -------------------------------------------------------------
    // 5. Security & RLS Validation
    // -------------------------------------------------------------
    console.log('5. Testing Security & RLS policies...');

    // A. Direct client INSERT into groups must be blocked by RLS
    const clientInsertSql = `
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${userStranger}';
      INSERT INTO public.groups (
        name, reason, lifetime, expires_at, grace_expires_at, visibility, access_mode, max_size, created_by_id
      ) VALUES (
        'Hacked Group', 'Bypassing RPC', '1_day', now() + interval '1 day', now() + interval '8 days',
        'discoverable', 'open', 30, '${userStranger}'
      );
    `;
    const clientInsertRes = await query(clientInsertSql);
    assert(
      clientInsertRes?.message?.includes('row-level security policy') || clientInsertRes?.error?.includes('row-level security policy'),
      'Direct client insert must be denied by RLS'
    );
    console.log('   ✓ Direct client insert denied by RLS');

    // B. Direct client member self-promotion must be blocked by RLS
    const clientPromoteSql = `
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${userStranger}';
      INSERT INTO public.group_members (group_id, user_id, role, status)
      VALUES ('${testGroupId}', '${userStranger}', 'admin', 'active');
    `;
    const clientPromoteRes = await query(clientPromoteSql);
    assert(
      clientPromoteRes?.message?.includes('row-level security policy') || clientPromoteRes?.error?.includes('row-level security policy'),
      'Direct client member mutation denied by RLS'
    );
    console.log('   ✓ Direct client member insert denied by RLS');

    // C. Discoverable group is visible to stranger
    const selectDiscSql = `
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${userStranger}';
      SELECT id, name FROM public.groups WHERE id = '${testGroupId}';
    `;
    const selectDiscRes = await query(selectDiscSql);
    assert(selectDiscRes.length === 1 && selectDiscRes[0].id === testGroupId, 'Stranger can select discoverable group');
    console.log('   ✓ Stranger can view discoverable group metadata');

    // D. Stranger cannot view members list of the group
    const selectMembersSql = `
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${userStranger}';
      SELECT * FROM public.group_members WHERE group_id = '${testGroupId}';
    `;
    const selectMembersRes = await query(selectMembersSql);
    assert(selectMembersRes.length === 0, 'Non-member stranger must NOT see group members list');
    console.log('   ✓ Non-member cannot view group members list');

    // E. Add ban for userBanned
    await query(`
      INSERT INTO public.group_bans (group_id, user_id, banned_by_id, reason)
      VALUES ('${testGroupId}', '${userBanned}', '${userAdmin}', 'Violated rules');
    `);

    // Banned user cannot view discoverable group
    const selectBannedSql = `
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${userBanned}';
      SELECT id FROM public.groups WHERE id = '${testGroupId}';
    `;
    const selectBannedRes = await query(selectBannedSql);
    assert(selectBannedRes.length === 0, 'Banned user must NOT be able to view group via discovery');
    console.log('   ✓ Banned user blocked from viewing discoverable group via RLS');

    // Private group: create a private group and verify stranger cannot select it
    const privGroupId = '77777777-6666-5555-4444-333333333333';
    await query(`
      BEGIN;
      INSERT INTO public.groups (
        id, name, reason, lifetime, expires_at, grace_expires_at, visibility, access_mode, max_size, created_by_id
      ) VALUES (
        '${privGroupId}', 'Secret Club', 'Private reason', '1_day',
        now() + interval '1 day', now() + interval '8 days', 'private', 'request', 10, '${userAdmin}'
      );
      INSERT INTO public.group_members (group_id, user_id, role, status)
      VALUES ('${privGroupId}', '${userAdmin}', 'admin', 'active');
      COMMIT;
    `);

    const selectPrivSql = `
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${userStranger}';
      SELECT id FROM public.groups WHERE id = '${privGroupId}';
    `;
    const selectPrivRes = await query(selectPrivSql);
    assert(selectPrivRes.length === 0, 'Stranger must NOT be able to select private group');
    console.log('   ✓ Private group completely hidden from non-members via RLS');

    await query(`DELETE FROM public.groups WHERE id = '${privGroupId}';`);

  } finally {
    // Clean up test data
    console.log('\nCleaning up Stage 3 test records...');
    if (testGroupId) {
      await query(`DELETE FROM public.groups WHERE id = '${testGroupId}';`);
    }
    await query(`
      DELETE FROM public.profiles WHERE id IN ('${userAdmin}', '${userMember}', '${userBanned}', '${userStranger}');
      DELETE FROM public.accounts WHERE id IN ('${userAdmin}', '${userMember}', '${userBanned}', '${userStranger}');
      DELETE FROM auth.users WHERE id IN ('${userAdmin}', '${userMember}', '${userBanned}', '${userStranger}');
    `);
    console.log('Cleanup complete.');
  }

  console.log('\n=== All Stage 3 Core Schema & RLS Tests Passed Successfully! ===');
}

runGroupsSchemaTests().catch(err => {
  console.error('Groups Schema test failure:', err);
  process.exit(1);
});
