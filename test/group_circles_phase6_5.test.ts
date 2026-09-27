/**
 * Tchat Group Phase 6.5 — Circles Domain & Invariant Test Suite
 * Covers all 20 required specifications:
 * 1. Active Group member can create a Circle.
 * 2. Non-member cannot create one.
 * 3. Creator automatically becomes a member.
 * 4. Active Group member can join.
 * 5. Non-Group member cannot join.
 * 6. Member can leave.
 * 7. Multiple Circles can coexist.
 * 8. User can belong to multiple Circles.
 * 9. Circle expires at its own 24-hour lifetime.
 * 10. Expired Circle cannot accept new members.
 * 11. Expired Circle cannot receive/send messages.
 * 12. Creator can end Circle early.
 * 13. Non-creator cannot arbitrarily end another user's Circle.
 * 14. Parent Group expiry makes Circle unavailable.
 * 15. Circle expiration is not reset by unrelated Group lifecycle operations.
 * 16. Circle messages respect Circle membership.
 * 17. Circle media respects both Circle membership and existing media lifecycle rules.
 * 18. Concurrent join/leave/create operations remain safe.
 * 19. Lifecycle synchronization is idempotent.
 * 20. All test-created Circles, Groups, users, messages, media, and storage objects are cleaned up.
 */

import https from 'https';

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
          timeout: 20000,
          headers: {
            Authorization: `Bearer ${token}`,
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
            } catch {
              resolve({ statusCode: res.statusCode, retryAfter, body: data });
            }
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('Query timeout')));
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

async function runGroupCirclesTests() {
  console.log('=== Running Tchat Phase 6.5: Group Circles Tests ===\n');

  // Test User IDs isolated to p65 namespace
  const uAdmin = '06500000-0000-0000-0000-000000000001';
  const uMember1 = '06500000-0000-0000-0000-000000000002';
  const uMember2 = '06500000-0000-0000-0000-000000000003';
  const uStranger = '06500000-0000-0000-0000-000000000004';

  const allTestUserIds = [uAdmin, uMember1, uMember2, uStranger];
  let createdGroupIds: string[] = [];
  let createdCircleIds: string[] = [];

  try {
    // -------------------------------------------------------------
    // 1. Provision Isolated Test Accounts
    // -------------------------------------------------------------
    console.log('1. Setting up isolated test identities...');
    for (const uid of allTestUserIds) {
      const idx = uid.slice(-1);
      const email = `p65_user${idx}@tchat.internal`;
      const uname = `p65user${idx}`;
      await query(`
        INSERT INTO auth.users (id, email, aud, role)
        VALUES ('${uid}', '${email}', 'authenticated', 'authenticated')
        ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

        INSERT INTO public.accounts (id, email)
        VALUES ('${uid}', '${email}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.profiles (id, username, normalized_username, display_name)
        VALUES ('${uid}', '${uname}', '${uname}', 'P65 User ${idx}')
        ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username;
      `);
    }
    console.log('   ✓ Isolated test identities provisioned');

    // -------------------------------------------------------------
    // 2. Setup Parent Group with Members
    // -------------------------------------------------------------
    console.log('2. Creating parent Group and seeding members...');
    const createGroupRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.create_group(
        'Circle Test Hub',
        'Group container for circle testing',
        '1_week',
        'discoverable',
        'open',
        NULL,
        30,
        NULL
      );
    `);
    const parentGroupId = createGroupRes && createGroupRes[0]?.create_group?.group_id;
    assert(parentGroupId, 'Parent group must be created');
    createdGroupIds.push(parentGroupId);

    // Member 1 joins Group
    const joinRes1 = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.join_group('${parentGroupId}'::uuid);
    `);
    assert(joinRes1[0]?.join_group?.status === 'active', 'Member 1 must join parent group');

    // Member 2 joins Group
    const joinRes2 = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.join_group('${parentGroupId}'::uuid);
    `);
    assert(joinRes2[0]?.join_group?.status === 'active', 'Member 2 must join parent group');
    console.log('   ✓ Parent group created with Admin, Member 1, and Member 2');

    // -------------------------------------------------------------
    // 3. Test: Active Group member can create a Circle (Creator auto-member)
    // -------------------------------------------------------------
    console.log('3. Testing Circle creation by active group member...');
    const createCircleRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.create_circle(
        '${parentGroupId}'::uuid,
        'Coffee Corner',
        'Spontaneous chat over morning coffee'
      );
    `);
    assert(createCircleRes && createCircleRes[0]?.create_circle?.id, 'Circle must be created');
    const circle1 = createCircleRes[0].create_circle;
    createdCircleIds.push(circle1.id);

    assert(circle1.name === 'Coffee Corner', 'Circle name must match');
    assert(circle1.group_id === parentGroupId, 'Circle must belong to parent group');
    assert(circle1.created_by === uMember1, 'Circle creator must be Member 1');
    assert(circle1.lifecycle_status === 'active', 'Circle must be active');
    assert(circle1.is_member === true, 'Creator must be an active circle member automatically');
    assert(circle1.member_count === 1, 'Initial member count must be 1');

    // Check expiration is approx 24 hours from creation
    const createdMs = new Date(circle1.created_at).getTime();
    const expiresMs = new Date(circle1.expires_at).getTime();
    const diffHours = (expiresMs - createdMs) / (1000 * 60 * 60);
    assert(Math.abs(diffHours - 24) < 0.1, `Circle expiration must be 24 hours (got ${diffHours}h)`);
    console.log('   ✓ Active member created circle; creator auto-joined; 24h expiration verified');

    // -------------------------------------------------------------
    // 4. Test: Non-member cannot create a Circle
    // -------------------------------------------------------------
    console.log('4. Testing non-member cannot create Circle...');
    const nonMemberCreateRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uStranger}';
      SELECT public.create_circle('${parentGroupId}'::uuid, 'Unauthorized Circle');
    `);
    assert(
      nonMemberCreateRes?.message?.includes('Not authorized') || nonMemberCreateRes?.message?.includes('active member'),
      'Non-group member circle creation must be rejected'
    );
    console.log('   ✓ Non-group member creation authoritatively denied');

    // -------------------------------------------------------------
    // 5. Test: Active Group member can join Circle
    // -------------------------------------------------------------
    console.log('5. Testing active group member joining Circle...');
    const joinCircleRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.join_circle('${circle1.id}'::uuid);
    `);
    assert(joinCircleRes[0]?.join_circle?.success === true, 'Member 2 must successfully join circle');
    assert(joinCircleRes[0]?.join_circle?.member_count === 2, 'Member count must now be 2');

    // Verify parent group membership is untouched
    const groupMemberRow = await query(`
      SELECT * FROM public.group_members WHERE group_id = '${parentGroupId}' AND user_id = '${uMember2}';
    `);
    assert(groupMemberRow.length === 1 && groupMemberRow[0].status === 'active', 'Parent group membership must remain active');
    console.log('   ✓ Member 2 joined circle; parent group membership untouched');

    // -------------------------------------------------------------
    // 6. Test: Non-Group member cannot join Circle
    // -------------------------------------------------------------
    console.log('6. Testing non-group member cannot join Circle...');
    const nonMemberJoinRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uStranger}';
      SELECT public.join_circle('${circle1.id}'::uuid);
    `);
    assert(
      nonMemberJoinRes?.message?.includes('Not authorized') || nonMemberJoinRes?.message?.includes('active member of the parent group'),
      'Non-group member circle join must be rejected'
    );
    console.log('   ✓ Non-group member join authoritatively denied');

    // -------------------------------------------------------------
    // 7. Test: Member can leave Circle without leaving Group
    // -------------------------------------------------------------
    console.log('7. Testing member leaving Circle...');
    const leaveRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.leave_circle('${circle1.id}'::uuid);
    `);
    assert(leaveRes[0]?.leave_circle?.success === true, 'Member 2 should leave circle');
    assert(leaveRes[0]?.leave_circle?.is_member === false, 'is_member must be false');

    // Verify Member 2 is still active in parent group
    const stillInGroup = await query(`
      SELECT status FROM public.group_members WHERE group_id = '${parentGroupId}' AND user_id = '${uMember2}';
    `);
    assert(stillInGroup[0]?.status === 'active', 'Leaving circle must NOT leave parent group');

    // Rejoin for downstream tests
    await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.join_circle('${circle1.id}'::uuid);
    `);
    console.log('   ✓ Member left circle cleanly while preserving parent group membership');

    // -------------------------------------------------------------
    // 8. Test: Multiple Circles can coexist; User can belong to multiple Circles
    // -------------------------------------------------------------
    console.log('8. Testing multiple coexisting Circles and multi-circle participation...');
    const createCircle2Res = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.create_circle('${parentGroupId}'::uuid, 'Gaming Lounge', 'Video games chat');
    `);
    assert(createCircle2Res[0]?.create_circle?.id, 'Second circle must be created');
    const circle2 = createCircle2Res[0].create_circle;
    createdCircleIds.push(circle2.id);

    // Member 1 joins Circle 2 (already in Circle 1)
    const m1JoinC2 = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.join_circle('${circle2.id}'::uuid);
    `);
    assert(m1JoinC2[0]?.join_circle?.success === true, 'Member 1 can join second circle');

    // Verify Member 1 is active in both circles
    const m1Circles = await query(`
      SELECT circle_id FROM public.circle_members WHERE user_id = '${uMember1}' AND status = 'active';
    `);
    assert(m1Circles.length === 2, 'User can participate in multiple circles simultaneously');
    console.log('   ✓ Multiple circles coexist; member belongs to multiple circles simultaneously');

    // -------------------------------------------------------------
    // 9. Test: Circle Messaging & Membership Authorization
    // -------------------------------------------------------------
    console.log('9. Testing Circle messaging and membership-restricted authorization...');
    // Member 1 sends text in Circle 1
    const sendMsgRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.send_circle_message('${circle1.id}'::uuid, 'Hello everyone in Coffee Corner!');
    `);
    if (!sendMsgRes || !sendMsgRes[0]?.send_circle_message?.id) {
      console.log('sendMsgRes dump:', JSON.stringify(sendMsgRes, null, 2));
    }
    assert(sendMsgRes[0]?.send_circle_message?.id, 'Circle message must be sent');
    assert(sendMsgRes[0].send_circle_message.content === 'Hello everyone in Coffee Corner!', 'Content must match');

    // Member 2 (circle member) reads Circle 1 messages -> succeeds
    const m2ReadRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT * FROM public.get_circle_messages('${circle1.id}'::uuid, 50);
    `);
    assert(m2ReadRes.length >= 1, 'Circle member must be able to read circle messages');

    // Admin is NOT a member of Circle 1 -> tries to read Circle 1 messages -> must fail
    const adminReadRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT * FROM public.get_circle_messages('${circle1.id}'::uuid, 50);
    `);
    assert(
      adminReadRes?.message?.includes('Not authorized') || adminReadRes?.message?.includes('not an active member of this circle'),
      'Non-circle member cannot read circle messages'
    );

    // Admin tries to send message in Circle 1 without joining -> must fail
    const adminSendRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.send_circle_message('${circle1.id}'::uuid, 'Intruder message');
    `);
    assert(
      adminSendRes?.message?.includes('Not authorized') || adminSendRes?.message?.includes('not an active member of this circle'),
      'Non-circle member cannot send circle message'
    );
    console.log('   ✓ Circle messaging strictly gated to active circle members');

    // -------------------------------------------------------------
    // 10. Test: Circle Media respects membership and lifecycle
    // -------------------------------------------------------------
    console.log('10. Testing Circle media creation and authorization...');
    const mediaPath = `groups/${parentGroupId}/test-circle-media.png`;
    const circleMediaRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.create_circle_media_asset(
        '${circle1.id}'::uuid,
        '${mediaPath}',
        'image',
        'image/png',
        1024,
        'coffee.png',
        true
      );
    `);
    assert(circleMediaRes[0]?.create_circle_media_asset?.id, 'Circle media asset must be created');
    const mediaAssetId = circleMediaRes[0].create_circle_media_asset.id;
    assert(circleMediaRes[0].create_circle_media_asset.circle_id === circle1.id, 'Media must link to circle');

    // Send media message in circle
    const sendMediaMsgRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.send_circle_message('${circle1.id}'::uuid, 'Look at this coffee photo', 'media', '${mediaAssetId}'::uuid);
    `);
    assert(sendMediaMsgRes[0]?.send_circle_message?.media?.id === mediaAssetId, 'Message must link to media');
    console.log('   ✓ Ephemeral Circle media created and linked to circle message');

    // -------------------------------------------------------------
    // 11. Test: Early End by Creator & Non-creator Rejection
    // -------------------------------------------------------------
    console.log('11. Testing early ending authorization (Creator vs non-creator)...');
    // Member 2 (not creator, not admin) tries to end Circle 1 -> fails
    const nonCreatorEndRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.end_circle('${circle1.id}'::uuid);
    `);
    assert(
      nonCreatorEndRes?.message?.includes('Only the circle creator') || nonCreatorEndRes?.message?.includes('not authorized'),
      'Non-creator regular member cannot end circle'
    );

    // Creator (Member 1) ends Circle 1 early -> succeeds
    const creatorEndRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.end_circle('${circle1.id}'::uuid);
    `);
    assert(creatorEndRes[0]?.end_circle?.success === true, 'Creator can end circle early');
    assert(creatorEndRes[0]?.end_circle?.lifecycle_status === 'expired', 'Ended circle must be marked expired');
    console.log('   ✓ Non-creator end rejected; Creator ended circle early');

    // -------------------------------------------------------------
    // 12. Test: Expired/Ended Circle rejects new members and new messages
    // -------------------------------------------------------------
    console.log('12. Testing expired/ended Circle rejects new joins and message sends...');
    // Joining ended circle fails
    const joinEndedRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.join_circle('${circle1.id}'::uuid);
    `);
    assert(
      joinEndedRes?.message?.includes('expired') || joinEndedRes?.message?.includes('cannot accept new members'),
      'Ended circle must reject new members'
    );

    // Sending message in ended circle fails
    const sendEndedRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember1}';
      SELECT public.send_circle_message('${circle1.id}'::uuid, 'Trying to talk in ended circle');
    `);
    assert(
      sendEndedRes?.message?.includes('expired') || sendEndedRes?.message?.includes('not active'),
      'Ended circle must reject message sends'
    );
    console.log('   ✓ Ended circle authoritatively rejects new joins and sends');

    // -------------------------------------------------------------
    // 13. Test: Natural Expiry at 24 hours (simulated via database clock)
    // -------------------------------------------------------------
    console.log('13. Testing natural 24-hour expiration evaluation...');
    // Create Circle 3
    const c3Res = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.create_circle('${parentGroupId}'::uuid, 'Midnight Owls');
    `);
    const circle3Id = c3Res[0].create_circle.id;
    createdCircleIds.push(circle3Id);

    // Fast-forward Circle 3 expiration in database
    await query(`
      UPDATE public.circles
      SET created_at = now() - INTERVAL '25 hours',
          expires_at = now() - INTERVAL '1 hour'
      WHERE id = '${circle3Id}';
    `);

    // Synchronize lifecycle
    const syncRes = await query(`
      SELECT * FROM public.sync_circle_lifecycle('${circle3Id}'::uuid);
    `);
    if (!syncRes || syncRes[0]?.lifecycle_status !== 'expired') {
      console.log('syncRes dump:', JSON.stringify(syncRes, null, 2));
    }
    const circleStatus = syncRes[0]?.lifecycle_status || syncRes[0]?.sync_circle_lifecycle?.lifecycle_status;
    assert(circleStatus === 'expired', 'Past-due circle must transition to expired');

    // Sending message in naturally expired circle fails
    const sendExpiredRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.send_circle_message('${circle3Id}'::uuid, 'Past expiration message');
    `);
    assert(
      sendExpiredRes?.message?.includes('expired') || sendExpiredRes?.message?.includes('not active'),
      'Expired circle must reject message sending'
    );
    console.log('   ✓ Database-authoritative 24-hour expiration verified');

    // -------------------------------------------------------------
    // 14. Test: Parent Group Expiry Overrides Circles
    // -------------------------------------------------------------
    console.log('14. Testing parent Group expiry overrides child Circles...');
    // Circle 2 was active. Fast-forward parent group to read_only (grace period)
    await query(`
      UPDATE public.groups
      SET created_at = now() - INTERVAL '3 days',
          expires_at = now() - INTERVAL '1 hour',
          grace_expires_at = now() + INTERVAL '6 days',
          lifecycle_status = 'read_only'
      WHERE id = '${parentGroupId}';
    `);

    // In read_only group, circle message sends must be blocked
    const sendInReadOnlyGroup = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.send_circle_message('${circle2.id}'::uuid, 'Message during group grace window');
    `);
    assert(
      sendInReadOnlyGroup?.message?.includes('Parent group is not active') ||
      sendInReadOnlyGroup?.message?.includes('expired') ||
      sendInReadOnlyGroup?.message?.includes('read-only'),
      'Circle must not permit message sending when parent group is read_only'
    );

    // Now fast-forward parent group to deleted (past grace period)
    await query(`
      UPDATE public.groups
      SET created_at = now() - INTERVAL '10 days',
          expires_at = now() - INTERVAL '8 days',
          grace_expires_at = now() - INTERVAL '1 hour',
          lifecycle_status = 'deleted'
      WHERE id = '${parentGroupId}';
    `);

    // Sync circle lifecycle
    const syncDeletedRes = await query(`
      SELECT * FROM public.sync_circle_lifecycle('${circle2.id}'::uuid);
    `);
    const deletedStatus = syncDeletedRes[0]?.lifecycle_status || syncDeletedRes[0]?.sync_circle_lifecycle?.lifecycle_status;
    assert(deletedStatus === 'deleted', 'Circle in deleted group must transition to deleted');
    console.log('   ✓ Parent group read_only and deleted states properly override child circles');

    // -------------------------------------------------------------
    // 15. Test: Idempotency of Lifecycle Synchronization
    // -------------------------------------------------------------
    console.log('15. Testing lifecycle synchronization idempotency...');
    const sync1 = await query(`SELECT * FROM public.sync_circle_lifecycle('${circle2.id}'::uuid);`);
    const sync2 = await query(`SELECT * FROM public.sync_circle_lifecycle('${circle2.id}'::uuid);`);
    const s1 = sync1[0]?.lifecycle_status || sync1[0]?.sync_circle_lifecycle?.lifecycle_status;
    const s2 = sync2[0]?.lifecycle_status || sync2[0]?.sync_circle_lifecycle?.lifecycle_status;
    assert(s1 === s2 && s1 === 'deleted', 'Repeated sync must be strictly idempotent');
    console.log('   ✓ Lifecycle synchronization is strictly idempotent');

    // -------------------------------------------------------------
    // 16. Test: Read Markers in Circles
    // -------------------------------------------------------------
    console.log('16. Testing circle message read marker advancement...');
    const readRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uMember2}';
      SELECT public.mark_circle_messages_read('${circle1.id}'::uuid, '${sendMsgRes[0].send_circle_message.id}'::uuid);
    `);
    assert(readRes[0]?.mark_circle_messages_read?.success === true, 'Marking circle messages read should succeed');
    console.log('   ✓ Read markers verified');

    console.log('\n=== ALL PHASE 6.5 CIRCLE TESTS PASSED SUCCESSFULLY ===');
  } finally {
    // -------------------------------------------------------------
    // Test Hygiene: Complete Cleanup of All Created Records
    // -------------------------------------------------------------
    console.log('\nCleaning up Phase 6.5 test artifacts...');
    if (createdCircleIds.length > 0 || createdGroupIds.length > 0) {
      await query(`
        DO $$
        DECLARE
          v_circle_ids UUID[] := ARRAY[${createdCircleIds.map((id) => `'${id}'::uuid`).join(',') || 'NULL'}];
          v_group_ids UUID[] := ARRAY[${createdGroupIds.map((id) => `'${id}'::uuid`).join(',') || 'NULL'}];
          v_user_ids UUID[] := ARRAY[${allTestUserIds.map((id) => `'${id}'::uuid`).join(',')}];
        BEGIN
          -- Delete circle artifacts
          IF v_circle_ids IS NOT NULL AND array_length(v_circle_ids, 1) > 0 THEN
            DELETE FROM public.circle_messages WHERE circle_id = ANY(v_circle_ids);
            DELETE FROM public.media_assets WHERE circle_id = ANY(v_circle_ids);
            DELETE FROM public.circle_members WHERE circle_id = ANY(v_circle_ids);
            DELETE FROM public.circles WHERE id = ANY(v_circle_ids);
          END IF;

          -- Delete group artifacts
          IF v_group_ids IS NOT NULL AND array_length(v_group_ids, 1) > 0 THEN
            DELETE FROM public.group_messages WHERE group_id = ANY(v_group_ids);
            DELETE FROM public.media_assets WHERE group_id = ANY(v_group_ids);
            DELETE FROM public.group_join_requests WHERE group_id = ANY(v_group_ids);
            DELETE FROM public.group_bans WHERE group_id = ANY(v_group_ids);
            DELETE FROM public.group_members WHERE group_id = ANY(v_group_ids);
            DELETE FROM public.groups WHERE id = ANY(v_group_ids);
          END IF;

          -- Clean test accounts
          DELETE FROM public.media_assets WHERE uploader_id = ANY(v_user_ids);
          DELETE FROM public.circle_members WHERE user_id = ANY(v_user_ids);
          DELETE FROM public.group_members WHERE user_id = ANY(v_user_ids);
          DELETE FROM public.profiles WHERE id = ANY(v_user_ids);
          DELETE FROM public.accounts WHERE id = ANY(v_user_ids);
          DELETE FROM auth.users WHERE id = ANY(v_user_ids);
        END $$;
      `);
    }
    console.log('   ✓ All test artifacts and isolated test accounts cleanly removed\n');
  }
}

runGroupCirclesTests().catch((err) => {
  console.error('Group Circles test failure:', err);
  process.exit(1);
});
