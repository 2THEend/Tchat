/**
 * Tchat — Phase 6.3 Checkpoint Fix: Group Media RLS Regression Tests
 *
 * Verifies:
 * 1. Active Group member can create Group media asset.
 * 2. Non-member cannot.
 * 3. Removed member cannot.
 * 4. Banned member cannot.
 * 5. Group media remains associated with the correct Group.
 * 6. Existing 1:1 media authorization still works.
 * 7. Existing 24-hour expiration remains unchanged.
 * 8. Saved-media authorization still works.
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
          } catch {
            resolve(data);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('=== Running Phase 6.3 Group Media RLS Regression Suite ===\n');

  const uAdmin = 'e7100000-0000-0000-0000-000000000001';
  const uActive = 'e7100000-0000-0000-0000-000000000002';
  const uRemoved = 'e7100000-0000-0000-0000-000000000003';
  const uBanned = 'e7100000-0000-0000-0000-000000000004';
  const uStranger = 'e7100000-0000-0000-0000-000000000005';
  const uFriend = 'e7100000-0000-0000-0000-000000000006';

  let testGroupId: string = '';
  let testConvId: string = '';
  let testGroupMediaId: string = '';

  try {
    // -------------------------------------------------------------
    // Setup Test Accounts & Profiles
    // -------------------------------------------------------------
    console.log('1. Setting up isolated test accounts and relations...');
    await query(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${uAdmin}', 'rls_admin@tchat.internal', 'authenticated', 'authenticated'),
        ('${uActive}', 'rls_active@tchat.internal', 'authenticated', 'authenticated'),
        ('${uRemoved}', 'rls_removed@tchat.internal', 'authenticated', 'authenticated'),
        ('${uBanned}', 'rls_banned@tchat.internal', 'authenticated', 'authenticated'),
        ('${uStranger}', 'rls_stranger@tchat.internal', 'authenticated', 'authenticated'),
        ('${uFriend}', 'rls_friend@tchat.internal', 'authenticated', 'authenticated')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.accounts (id, email) VALUES
        ('${uAdmin}', 'rls_admin@tchat.internal'),
        ('${uActive}', 'rls_active@tchat.internal'),
        ('${uRemoved}', 'rls_removed@tchat.internal'),
        ('${uBanned}', 'rls_banned@tchat.internal'),
        ('${uStranger}', 'rls_stranger@tchat.internal'),
        ('${uFriend}', 'rls_friend@tchat.internal')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.profiles (id, username, normalized_username, display_name) VALUES
        ('${uAdmin}', 'rls_admin', 'rls_admin', 'RLS Admin'),
        ('${uActive}', 'rls_active', 'rls_active', 'RLS Active Member'),
        ('${uRemoved}', 'rls_removed', 'rls_removed', 'RLS Removed Member'),
        ('${uBanned}', 'rls_banned', 'rls_banned', 'RLS Banned Member'),
        ('${uStranger}', 'rls_stranger', 'rls_stranger', 'RLS Stranger'),
        ('${uFriend}', 'rls_friend', 'rls_friend', 'RLS Friend')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Create an active group
    const grpRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.create_group(
        'RLS Media Test Group',
        'Group to test RLS policies for ephemeral media',
        '1_week',
        'discoverable',
        'open',
        NULL,
        20
      );
    `);
    testGroupId = grpRes[0]?.create_group?.group_id;
    assert(!!testGroupId, 'Group created successfully');

    // Set up group memberships: active, removed, banned
    await query(`
      -- uActive joins
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uActive}';
      SELECT public.join_group('${testGroupId}'::uuid);

      -- uRemoved joins
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uRemoved}';
      SELECT public.join_group('${testGroupId}'::uuid);

      -- uBanned joins
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uBanned}';
      SELECT public.join_group('${testGroupId}'::uuid);

      -- uAdmin removes uRemoved
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.remove_group_member('${testGroupId}'::uuid, '${uRemoved}'::uuid);

      -- uAdmin bans uBanned
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.ban_group_member('${testGroupId}'::uuid, '${uBanned}'::uuid, 'Test ban');
    `);
    console.log('   ✓ Test accounts and group roles initialized');

    // -------------------------------------------------------------
    // Test 1: Active Group member can create Group media asset
    // -------------------------------------------------------------
    console.log('\n2. Testing active group member media creation...');
    const nowTs = Date.now();
    const storagePathActive = `groups/${testGroupId}/${nowTs}-active-photo.png`;

    // A) Storage upload (INSERT into storage.objects)
    const storageInsert = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uActive}';
      INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('conversation-media', '${storagePathActive}', '${uActive}')
      RETURNING id, name, bucket_id, owner;
    `);
    assert(
      Array.isArray(storageInsert) && storageInsert[0]?.name === storagePathActive,
      'Active group member can upload file to storage.objects'
    );

    // B) Register Media Asset via create_group_media_asset RPC
    const mediaRpc = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uActive}';
      SELECT public.create_group_media_asset(
        '${testGroupId}'::uuid,
        '${storagePathActive}',
        'image',
        'image/png',
        2048,
        'active-photo.png',
        true
      ) as media;
    `);
    assert(mediaRpc && mediaRpc[0]?.media?.id, 'create_group_media_asset RPC succeeds for active member');
    testGroupMediaId = mediaRpc[0].media.id;

    // C) Direct INSERT into public.media_assets table under RLS
    const directInsert = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uActive}';
      INSERT INTO public.media_assets (
        group_id,
        uploader_id,
        storage_path,
        media_type,
        mime_type,
        file_size_bytes,
        original_filename,
        allow_recipient_save,
        is_saved,
        expires_at
      ) VALUES (
        '${testGroupId}'::uuid,
        '${uActive}'::uuid,
        'groups/${testGroupId}/${nowTs}-active-direct.png',
        'image',
        'image/png',
        1024,
        'active-direct.png',
        true,
        false,
        now() + interval '24 hours'
      )
      RETURNING id, group_id;
    `);
    assert(
      Array.isArray(directInsert) && directInsert[0]?.id,
      'Active group member satisfies media_assets INSERT RLS policy'
    );
    console.log('   ✓ Active group member successfully creates group media via storage & table RLS');

    // -------------------------------------------------------------
    // Test 2: Non-member cannot create Group media asset
    // -------------------------------------------------------------
    console.log('\n3. Testing non-member denial...');
    // Storage upload attempt by non-member
    const strangerStorage = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uStranger}';
      INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('conversation-media', 'groups/${testGroupId}/stranger.png', '${uStranger}')
      RETURNING id;
    `);
    assert(
      strangerStorage.message?.includes('row-level security policy') || strangerStorage.code === '42501',
      'Non-member is blocked from storage.objects INSERT by RLS'
    );

    // Direct media_assets insert attempt by non-member
    const strangerTable = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uStranger}';
      INSERT INTO public.media_assets (
        group_id,
        uploader_id,
        storage_path,
        media_type,
        mime_type,
        file_size_bytes,
        original_filename,
        allow_recipient_save,
        is_saved,
        expires_at
      ) VALUES (
        '${testGroupId}'::uuid,
        '${uStranger}'::uuid,
        'groups/${testGroupId}/stranger.png',
        'image',
        'image/png',
        1024,
        'stranger.png',
        true,
        false,
        now() + interval '24 hours'
      )
      RETURNING id;
    `);
    assert(
      strangerTable.message?.includes('row-level security policy') || strangerTable.code === '42501',
      'Non-member is blocked from media_assets INSERT by RLS'
    );

    // RPC attempt by non-member
    const strangerRpc = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uStranger}';
      SELECT public.create_group_media_asset(
        '${testGroupId}'::uuid,
        'groups/${testGroupId}/stranger.png',
        'image',
        'image/png',
        1024,
        'stranger.png',
        true
      );
    `);
    assert(
      strangerRpc.message?.includes('Not authorized') || strangerRpc.code === 'P0001',
      'Non-member is blocked by create_group_media_asset RPC'
    );
    console.log('   ✓ Non-members are authoritatively blocked across Storage, Table RLS, and RPC');

    // -------------------------------------------------------------
    // Test 3: Removed member cannot create Group media asset
    // -------------------------------------------------------------
    console.log('\n4. Testing removed member denial...');
    const removedStorage = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uRemoved}';
      INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('conversation-media', 'groups/${testGroupId}/removed.png', '${uRemoved}')
      RETURNING id;
    `);
    assert(
      removedStorage.message?.includes('row-level security policy') || removedStorage.code === '42501',
      'Removed member is blocked from storage.objects INSERT by RLS'
    );

    const removedTable = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uRemoved}';
      INSERT INTO public.media_assets (
        group_id,
        uploader_id,
        storage_path,
        media_type,
        mime_type,
        file_size_bytes,
        original_filename,
        allow_recipient_save,
        is_saved,
        expires_at
      ) VALUES (
        '${testGroupId}'::uuid,
        '${uRemoved}'::uuid,
        'groups/${testGroupId}/removed.png',
        'image',
        'image/png',
        1024,
        'removed.png',
        true,
        false,
        now() + interval '24 hours'
      )
      RETURNING id;
    `);
    assert(
      removedTable.message?.includes('row-level security policy') || removedTable.code === '42501',
      'Removed member is blocked from media_assets INSERT by RLS'
    );
    console.log('   ✓ Removed member is authoritatively blocked by RLS');

    // -------------------------------------------------------------
    // Test 4: Banned member cannot create Group media asset
    // -------------------------------------------------------------
    console.log('\n5. Testing banned member denial...');
    const bannedStorage = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uBanned}';
      INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('conversation-media', 'groups/${testGroupId}/banned.png', '${uBanned}')
      RETURNING id;
    `);
    assert(
      bannedStorage.message?.includes('row-level security policy') || bannedStorage.code === '42501',
      'Banned member is blocked from storage.objects INSERT by RLS'
    );

    const bannedTable = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uBanned}';
      INSERT INTO public.media_assets (
        group_id,
        uploader_id,
        storage_path,
        media_type,
        mime_type,
        file_size_bytes,
        original_filename,
        allow_recipient_save,
        is_saved,
        expires_at
      ) VALUES (
        '${testGroupId}'::uuid,
        '${uBanned}'::uuid,
        'groups/${testGroupId}/banned.png',
        'image',
        'image/png',
        1024,
        'banned.png',
        true,
        false,
        now() + interval '24 hours'
      )
      RETURNING id;
    `);
    assert(
      bannedTable.message?.includes('row-level security policy') || bannedTable.code === '42501',
      'Banned member is blocked from media_assets INSERT by RLS'
    );
    console.log('   ✓ Banned member is authoritatively blocked by RLS');

    // -------------------------------------------------------------
    // Test 5: Group media remains associated with correct Group
    // -------------------------------------------------------------
    console.log('\n6. Testing group association integrity...');
    const fetchAsset = await query(`
      SELECT id, group_id, conversation_id, uploader_id, storage_path, is_ephemeral, allow_recipient_save, is_saved
      FROM public.media_assets
      WHERE id = '${testGroupMediaId}';
    `);
    assert(Array.isArray(fetchAsset) && fetchAsset.length === 1, 'Asset retrieved from database');
    assert(fetchAsset[0].group_id === testGroupId, 'Asset group_id matches target group');
    assert(fetchAsset[0].conversation_id === null, 'Asset conversation_id is NULL for group media');
    assert(fetchAsset[0].uploader_id === uActive, 'Asset uploader_id matches caller');
    assert(fetchAsset[0].is_ephemeral === true, 'Group media starts as ephemeral');
    assert(fetchAsset[0].is_saved === false, 'Group media starts as unsaved');
    console.log('   ✓ Group media association strictly preserved');

    // -------------------------------------------------------------
    // Test 6: Existing 1:1 media authorization still works
    // -------------------------------------------------------------
    console.log('\n7. Testing existing 1:1 conversation media authorization...');
    // Create 1:1 connection and conversation between uActive and uFriend
    await query(`
      INSERT INTO public.connections (user_a_id, user_b_id)
      VALUES (
        LEAST('${uActive}'::uuid, '${uFriend}'::uuid),
        GREATEST('${uActive}'::uuid, '${uFriend}'::uuid)
      ) ON CONFLICT DO NOTHING;
    `);

    const convRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uActive}';
      SELECT public.get_or_create_conversation('${uFriend}'::uuid) as conv;
    `);
    testConvId = convRes[0]?.conv?.id;
    assert(!!testConvId, '1:1 conversation found or created');

    // A) 1:1 Storage Upload
    const convNowTs = Date.now();
    const convStoragePath = `${testConvId}/${convNowTs}-1to1-test.png`;
    const convStorage = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uActive}';
      INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('conversation-media', '${convStoragePath}', '${uActive}')
      RETURNING id, name;
    `);
    assert(
      Array.isArray(convStorage) && convStorage[0]?.name === convStoragePath,
      '1:1 conversation participant can upload to storage.objects'
    );

    // B) 1:1 create_media_asset RPC
    const convRpc = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uActive}';
      SELECT public.create_media_asset(
        '${testConvId}'::uuid,
        '${convStoragePath}',
        'image',
        'image/png',
        1024,
        '1to1-test.png',
        true
      ) as media;
    `);
    assert(convRpc && convRpc[0]?.media?.id, '1:1 create_media_asset RPC succeeds');
    const convMediaId = convRpc[0].media.id;

    // C) 1:1 Direct media_assets table INSERT under RLS
    const convDirect = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uActive}';
      INSERT INTO public.media_assets (
        conversation_id,
        uploader_id,
        storage_path,
        media_type,
        mime_type,
        file_size_bytes,
        original_filename,
        allow_recipient_save,
        is_saved,
        expires_at
      ) VALUES (
        '${testConvId}'::uuid,
        '${uActive}'::uuid,
        '${testConvId}/${convNowTs}-1to1-direct.png',
        'image',
        'image/png',
        512,
        '1to1-direct.png',
        true,
        false,
        now() + interval '24 hours'
      )
      RETURNING id, conversation_id;
    `);
    assert(
      Array.isArray(convDirect) && convDirect[0]?.id,
      '1:1 conversation participant satisfies media_assets INSERT RLS policy'
    );
    console.log('   ✓ Existing 1:1 conversation media authorization fully intact');

    // -------------------------------------------------------------
    // Test 7: Existing 24-hour expiration remains unchanged
    // -------------------------------------------------------------
    console.log('\n8. Testing 24-hour expiration invariant...');
    const expCheck = await query(`
      SELECT 
        created_at, 
        expires_at, 
        (expires_at - created_at) as duration,
        EXTRACT(EPOCH FROM (expires_at - created_at)) as duration_seconds
      FROM public.media_assets
      WHERE id = '${testGroupMediaId}';
    `);
    assert(Array.isArray(expCheck) && expCheck.length === 1, 'Group media expiration verified');
    const durationSeconds = Number(expCheck[0].duration_seconds);
    // 24 hours = 86400 seconds
    assert(
      Math.abs(durationSeconds - 86400) <= 2,
      `Duration must be exactly 86400 seconds (24h). Got: ${durationSeconds}`
    );
    console.log(`   ✓ 24-hour expiration duration verified (${durationSeconds}s = exactly 24 hours)`);

    // -------------------------------------------------------------
    // Test 8: Saved-media authorization still works
    // -------------------------------------------------------------
    console.log('\n9. Testing saved-media authorization in group...');
    // Recipient admin saves the media asset via save_media_asset RPC
    const saveRes = await query(`
      SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claim.sub" TO '${uAdmin}';
      SELECT public.save_media_asset('${testGroupMediaId}'::uuid) as saved;
    `);
    assert(saveRes && saveRes[0]?.saved?.is_saved === true, 'save_media_asset RPC succeeds for recipient');
    assert(saveRes[0].saved.saved_by_id === uAdmin, 'saved_by_id recorded as caller');

    // Verify persisted state in media_assets
    const savedCheck = await query(`
      SELECT is_saved, saved_at, saved_by_id 
      FROM public.media_assets 
      WHERE id = '${testGroupMediaId}';
    `);
    assert(savedCheck[0].is_saved === true, 'media_assets.is_saved is true in database');
    assert(savedCheck[0].saved_by_id === uAdmin, 'media_assets.saved_by_id matches saving member');
    console.log('   ✓ Saved-media authorization converts group media to permanent cleanly');

    console.log('\n=== ALL PHASE 6.3 GROUP MEDIA RLS REGRESSION TESTS PASSED ===');
  } catch (err) {
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
  } finally {
    // Cleanup test artifacts
    console.log('\nCleaning up test artifacts...');
    if (testGroupId) {
      await query(`
        DELETE FROM public.group_messages WHERE group_id = '${testGroupId}';
        DELETE FROM public.media_assets WHERE group_id = '${testGroupId}';
        DELETE FROM public.group_bans WHERE group_id = '${testGroupId}';
        DELETE FROM public.group_members WHERE group_id = '${testGroupId}';
        DELETE FROM public.groups WHERE id = '${testGroupId}';
        DELETE FROM storage.objects WHERE bucket_id = 'conversation-media' AND (storage.foldername(name))[1] = 'groups' AND (storage.foldername(name))[2] = '${testGroupId}';
      `);
    }
    if (testConvId) {
      await query(`
        DELETE FROM public.messages WHERE conversation_id = '${testConvId}';
        DELETE FROM public.media_assets WHERE conversation_id = '${testConvId}';
        DELETE FROM public.conversations WHERE id = '${testConvId}';
        DELETE FROM storage.objects WHERE bucket_id = 'conversation-media' AND (storage.foldername(name))[1] = '${testConvId}';
      `);
    }
    await query(`
      DELETE FROM public.connections WHERE user_a_id IN ('${uActive}', '${uFriend}') AND user_b_id IN ('${uActive}', '${uFriend}');
      DELETE FROM public.profiles WHERE id IN ('${uAdmin}', '${uActive}', '${uRemoved}', '${uBanned}', '${uStranger}', '${uFriend}');
      DELETE FROM public.accounts WHERE id IN ('${uAdmin}', '${uActive}', '${uRemoved}', '${uBanned}', '${uStranger}', '${uFriend}');
      DELETE FROM auth.users WHERE id IN ('${uAdmin}', '${uActive}', '${uRemoved}', '${uBanned}', '${uStranger}', '${uFriend}');
    `);
    console.log('Cleanup complete.');
  }
}

runTests();
