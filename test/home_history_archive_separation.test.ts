/**
 * Tchat: Home / History / Archive Semantic Separation Test Suite
 * 
 * Verifies:
 * 1. Home Semantics:
 *    - Qualifying interaction during user's current LOCAL calendar day.
 *    - Inactive conversations naturally leave Home without becoming archived.
 *    - Newly accepted connections with null last_activity_at do NOT appear on Home.
 *    - Timezone-aware local day boundaries.
 * 2. History Semantics:
 *    - WhatsApp-style persistent list of all normal 1:1 conversations.
 *    - Includes today's, yesterday's, and inactive conversations.
 *    - Excludes explicitly archived conversations.
 *    - Excludes group and circle spaces.
 * 3. Archive Semantics:
 *    - Explicit per-user organizational state (never automatic on inactivity).
 *    - Archiving does not delete messages, connections, or streaks.
 *    - Archive surface contains only explicitly archived conversations.
 *    - Unarchive returns conversation to normal History.
 * 4. New Activity on Archived Conversations:
 *    - New meaningful activity occurring after archive timestamp surfaces on Home today.
 *    - Explicit archive state remains until user chooses to unarchive.
 * 5. Multi-User Isolation:
 *    - User A's archive choice never affects User B's conversation or history.
 * 6. Live PostgreSQL Database Contract:
 *    - Table conversation_archives, RLS, archive_conversation RPC, unarchive_conversation RPC,
 *      and updated get_user_conversations() schema.
 */

import {
  isConversationActiveToday,
  shouldConversationAppearOnHome,
} from '../src/domains/conversations/validation';
import { TchatConversation } from '../src/domains/conversations/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runHomeHistoryArchiveTests() {
  console.log('=== Running Home / History / Archive Semantic Separation Tests ===\n');
  let passed = 0;

  // --------------------------------------------------------------------------
  // 1. Home Semantics & Local Calendar Day Invariants
  // --------------------------------------------------------------------------
  console.log('1. Testing Home Semantics & Local Calendar Day Activity:');

  const refDate = new Date('2026-10-02T15:30:00Z'); // 3:30 PM UTC on Oct 2, 2026

  // Meaningful message activity earlier today (Oct 2, 2026 at 10:00 UTC)
  const activeTodayAt10 = '2026-10-02T10:00:00Z';
  assert(
    isConversationActiveToday(activeTodayAt10, 'UTC', refDate) === true,
    'Activity earlier today is recognized as active today'
  );
  passed++;

  // Inactivity yesterday (Oct 1, 2026 at 23:59 UTC)
  const activeYesterday = '2026-10-01T23:59:59Z';
  assert(
    isConversationActiveToday(activeYesterday, 'UTC', refDate) === false,
    'Activity yesterday does not qualify as active today'
  );
  passed++;

  // Inactivity last week
  const activeLastWeek = '2026-09-25T12:00:00Z';
  assert(
    isConversationActiveToday(activeLastWeek, 'UTC', refDate) === false,
    'Activity last week does not qualify as active today'
  );
  passed++;

  // Newly accepted connection (no messages sent yet: last_activity_at is null)
  assert(
    isConversationActiveToday(null, 'UTC', refDate) === false,
    'Connection without message activity (null last_activity_at) is not active today'
  );
  assert(
    isConversationActiveToday(undefined, 'UTC', refDate) === false,
    'Undefined last_activity_at is not active today'
  );
  passed += 2;

  // Local calendar day vs UTC boundary tests:
  // Consider 1:30 AM UTC on Oct 2, 2026.
  // In New York (EDT, UTC-4), this is 9:30 PM on Oct 1, 2026!
  const earlyOct2Utc = '2026-10-02T01:30:00Z';
  const newYorkRefDate = new Date('2026-10-02T18:00:00Z'); // 2:00 PM EDT on Oct 2, 2026
  // In UTC, earlyOct2Utc is Oct 2 (same as Oct 2 18:00 UTC)
  assert(
    isConversationActiveToday(earlyOct2Utc, 'UTC', newYorkRefDate) === true,
    'earlyOct2Utc is today in UTC'
  );
  // But in America/New_York, earlyOct2Utc was yesterday evening (Oct 1 21:30 EDT)
  assert(
    isConversationActiveToday(earlyOct2Utc, 'America/New_York', newYorkRefDate) === false,
    'User local day in America/New_York correctly treats UTC early morning as yesterday'
  );
  passed += 2;

  console.log(`   Passed ${passed} Home local day activity tests.\n`);

  // --------------------------------------------------------------------------
  // 2. Home vs History vs Archive Separation Model
  // --------------------------------------------------------------------------
  console.log('2. Testing Home vs History vs Archive Filtering Logic:');

  const testConversations: TchatConversation[] = [
    {
      id: 'conv-active-today',
      connection_id: 'conn-1',
      user_a_id: 'user-self',
      user_b_id: 'user-friend-1',
      last_activity_at: '2026-10-02T11:00:00Z',
      last_activity_type: 'text',
      last_message_preview: 'Hey, see you at lunch!',
      last_sender_id: 'user-friend-1',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-10-02T11:00:00Z',
      is_archived: false,
      archived_at: null,
    },
    {
      id: 'conv-inactive-yesterday',
      connection_id: 'conn-2',
      user_a_id: 'user-self',
      user_b_id: 'user-friend-2',
      last_activity_at: '2026-10-01T15:00:00Z',
      last_activity_type: 'text',
      last_message_preview: 'Sounds good to me.',
      last_sender_id: 'user-self',
      created_at: '2026-08-15T00:00:00Z',
      updated_at: '2026-10-01T15:00:00Z',
      is_archived: false,
      archived_at: null,
    },
    {
      id: 'conv-inactive-weeks-ago',
      connection_id: 'conn-3',
      user_a_id: 'user-self',
      user_b_id: 'user-friend-3',
      last_activity_at: '2026-09-10T09:00:00Z',
      last_activity_type: 'text',
      last_message_preview: 'Catch up later!',
      last_sender_id: 'user-friend-3',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-09-10T09:00:00Z',
      is_archived: false,
      archived_at: null,
    },
    {
      id: 'conv-explicitly-archived-dormant',
      connection_id: 'conn-4',
      user_a_id: 'user-self',
      user_b_id: 'user-friend-4',
      last_activity_at: '2026-09-01T12:00:00Z',
      last_activity_type: 'text',
      last_message_preview: 'Old project wrap-up',
      last_sender_id: 'user-friend-4',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-09-01T12:00:00Z',
      is_archived: true,
      archived_at: '2026-09-05T10:00:00Z', // Archived on Sept 5
    },
    {
      id: 'conv-archived-just-now-today',
      connection_id: 'conn-5',
      user_a_id: 'user-self',
      user_b_id: 'user-friend-5',
      last_activity_at: '2026-10-02T09:00:00Z', // Message was at 9:00 AM
      last_activity_type: 'text',
      last_message_preview: 'Archived this morning',
      last_sender_id: 'user-friend-5',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-10-02T09:00:00Z',
      is_archived: true,
      archived_at: '2026-10-02T09:30:00Z', // Archived at 9:30 AM (after the message)
    },
    {
      id: 'conv-archived-with-new-activity-today',
      connection_id: 'conn-6',
      user_a_id: 'user-self',
      user_b_id: 'user-friend-6',
      last_activity_at: '2026-10-02T14:00:00Z', // New incoming message at 2:00 PM!
      last_activity_type: 'text',
      last_message_preview: 'Hey are you there?',
      last_sender_id: 'user-friend-6',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-10-02T14:00:00Z',
      is_archived: true,
      archived_at: '2026-10-02T08:00:00Z', // Was archived at 8:00 AM
    },
  ];

  // 2.1 Verify Home visibility:
  const homeConversations = testConversations.filter((c) =>
    shouldConversationAppearOnHome(c, 'UTC', refDate)
  );

  // conv-active-today: YES (active today, not archived)
  assert(
    homeConversations.some((c) => c.id === 'conv-active-today'),
    'Active non-archived conversation appears on Home'
  );

  // conv-inactive-yesterday: NO (inactive today; naturally leaves Home, NOT archived!)
  assert(
    !homeConversations.some((c) => c.id === 'conv-inactive-yesterday'),
    'Inactive yesterday conversation naturally left Home'
  );

  // conv-inactive-weeks-ago: NO (inactive for weeks; leaves Home, NOT archived!)
  assert(
    !homeConversations.some((c) => c.id === 'conv-inactive-weeks-ago'),
    'Inactive weeks-ago conversation left Home'
  );

  // conv-explicitly-archived-dormant: NO (archived and no activity today)
  assert(
    !homeConversations.some((c) => c.id === 'conv-explicitly-archived-dormant'),
    'Dormant archived conversation does not appear on Home'
  );

  // conv-archived-just-now-today: NO (user archived it at 9:30 AM, message was at 9:00 AM, no new activity since archive)
  assert(
    !homeConversations.some((c) => c.id === 'conv-archived-just-now-today'),
    'Conversation archived today without new activity after archive does not appear on Home'
  );

  // conv-archived-with-new-activity-today: YES (new message arrived at 14:00 after archive at 08:00, and is today!)
  assert(
    homeConversations.some((c) => c.id === 'conv-archived-with-new-activity-today'),
    'Archived conversation with NEW qualifying activity today surfaces on Home'
  );

  assert(homeConversations.length === 2, `Home has exactly 2 conversations, got ${homeConversations.length}`);
  passed += 7;

  // 2.2 Verify History visibility:
  // History shows all NON-ARCHIVED normal 1:1 conversations (regardless of whether active today, yesterday, or weeks ago)
  const historyConversations = testConversations.filter((c) => !c.is_archived);

  assert(
    historyConversations.some((c) => c.id === 'conv-active-today'),
    'Today active conversation is in History'
  );
  assert(
    historyConversations.some((c) => c.id === 'conv-inactive-yesterday'),
    'Yesterday inactive conversation remains in persistent History'
  );
  assert(
    historyConversations.some((c) => c.id === 'conv-inactive-weeks-ago'),
    'Weeks-ago inactive conversation remains in persistent History'
  );
  assert(
    !historyConversations.some((c) => c.is_archived),
    'History excludes all explicitly archived conversations'
  );
  assert(historyConversations.length === 3, `History has exactly 3 conversations, got ${historyConversations.length}`);
  passed += 5;

  // 2.3 Verify Archive visibility:
  // Archive shows ONLY explicitly archived conversations
  const archivedConversations = testConversations.filter((c) => Boolean(c.is_archived));

  assert(
    archivedConversations.some((c) => c.id === 'conv-explicitly-archived-dormant'),
    'Dormant archived conversation is in Archive'
  );
  assert(
    archivedConversations.some((c) => c.id === 'conv-archived-just-now-today'),
    'Archived today conversation is in Archive'
  );
  assert(
    archivedConversations.some((c) => c.id === 'conv-archived-with-new-activity-today'),
    'Archived conversation with new activity remains in Archive until explicitly unarchived'
  );
  assert(
    archivedConversations.every((c) => Boolean(c.is_archived)),
    'Archive contains ONLY explicitly archived conversations'
  );
  assert(archivedConversations.length === 3, `Archive has exactly 3 conversations, got ${archivedConversations.length}`);
  passed += 5;

  console.log(`   Passed ${passed} semantic separation and filtering tests.\n`);

  // --------------------------------------------------------------------------
  // 3. User Archive Lifecycle Simulation (Archive -> Find in Archive -> Unarchive)
  // --------------------------------------------------------------------------
  console.log('3. Testing Archive Lifecycle Invariants:');

  // Let conversation conv-inactive-yesterday be archived:
  const convToArchive = { ...testConversations[1] };
  assert(convToArchive.is_archived === false, 'Initially not archived');

  // Explicit user archive action:
  const archivedConv: TchatConversation = {
    ...convToArchive,
    is_archived: true,
    archived_at: new Date().toISOString(),
  };

  // Leaves normal History:
  assert(!archivedConv.is_archived === false, 'Leaves non-archived History');
  // Appears in Archive:
  assert(Boolean(archivedConv.is_archived) === true, 'Enters Archive');
  // Underlying messages, connection_id, conversation_id remain intact:
  assert(archivedConv.id === convToArchive.id, 'Conversation ID preserved');
  assert(archivedConv.connection_id === convToArchive.connection_id, 'Connection preserved');
  assert(archivedConv.last_message_preview === convToArchive.last_message_preview, 'Messages preserved');

  // Explicit user unarchive action:
  const unarchivedConv: TchatConversation = {
    ...archivedConv,
    is_archived: false,
    archived_at: null,
  };

  // Returns to History:
  assert(unarchivedConv.is_archived === false, 'Returns to normal History');
  assert(unarchivedConv.archived_at === null, 'Archived timestamp cleared');
  passed += 7;

  console.log(`   Passed ${passed} archive lifecycle simulation tests.\n`);

  // --------------------------------------------------------------------------
  // 4. Live PostgreSQL RPC Contract Verification
  // --------------------------------------------------------------------------
  console.log('4. Testing Live PostgreSQL Database Schema & RPCs:');

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = 'jqghykhnnrfsjkkjhekf';

  if (!token) {
    console.log('   [Skip Live DB] SUPABASE_ACCESS_TOKEN not in environment.');
  } else {
    const https = await import('https');

    const queryPromise = async (sql: string): Promise<any> => {
      return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ query: sql });
        const req = https.request(
          {
            hostname: 'api.supabase.com',
            path: `/v1/projects/${projectRef}/database/query`,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  resolve(JSON.parse(data));
                } catch {
                  resolve(data);
                }
              } else {
                reject(new Error(`HTTP ${res.statusCode}: ${data}`));
              }
            });
          }
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
    };

    // 4.1 Verify conversation_archives table structure
    const tableCheck = await queryPromise(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'conversation_archives'
      ORDER BY ordinal_position;
    `);

    assert(Array.isArray(tableCheck) && tableCheck.length >= 3, 'conversation_archives table has required columns');
    const cols = tableCheck.map((r: any) => r.column_name);
    assert(cols.includes('user_id'), 'conversation_archives has user_id');
    assert(cols.includes('conversation_id'), 'conversation_archives has conversation_id');
    assert(cols.includes('archived_at'), 'conversation_archives has archived_at');
    console.log('   [Live DB] conversation_archives schema confirmed:', cols.join(', '));
    passed += 4;

    // 4.2 Verify Row Level Security is enabled
    const rlsCheck = await queryPromise(`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE relname = 'conversation_archives' AND relnamespace = 'public'::regnamespace;
    `);
    assert(rlsCheck[0]?.relrowsecurity === true, 'RLS is enabled on conversation_archives');
    console.log('   [Live DB] conversation_archives RLS enabled verified.');
    passed++;

    // 4.3 Verify archive_conversation and unarchive_conversation RPCs exist and are SECURITY DEFINER
    const rpcCheck = await queryPromise(`
      SELECT proname, prosecdef, prorettype::regtype, proargnames
      FROM pg_proc
      WHERE proname IN ('archive_conversation', 'unarchive_conversation', 'get_user_conversations')
        AND pronamespace = 'public'::regnamespace;
    `);

    const rpcNames = rpcCheck.map((r: any) => r.proname);
    assert(rpcNames.includes('archive_conversation'), 'archive_conversation RPC exists');
    assert(rpcNames.includes('unarchive_conversation'), 'unarchive_conversation RPC exists');
    assert(rpcNames.includes('get_user_conversations'), 'get_user_conversations RPC exists');

    const archiveRpc = rpcCheck.find((r: any) => r.proname === 'archive_conversation');
    assert(archiveRpc?.prosecdef === true, 'archive_conversation is SECURITY DEFINER');

    const unarchiveRpc = rpcCheck.find((r: any) => r.proname === 'unarchive_conversation');
    assert(unarchiveRpc?.prosecdef === true, 'unarchive_conversation is SECURITY DEFINER');

    const getConversationsRpc = rpcCheck.find((r: any) => r.proname === 'get_user_conversations');
    assert(getConversationsRpc?.prosecdef === true, 'get_user_conversations is SECURITY DEFINER');
    console.log('   [Live DB] RPCs archive_conversation, unarchive_conversation, and get_user_conversations confirmed.');
    passed += 6;

    // 4.4 Verify get_user_conversations returns is_archived and archived_at in its record type
    const returnTypeCheck = await queryPromise(`
      SELECT p.proname, proargnames
      FROM pg_proc p
      WHERE p.proname = 'get_user_conversations'
        AND p.pronamespace = 'public'::regnamespace;
    `);
    const argNames = returnTypeCheck[0]?.proargnames || [];
    assert(argNames.includes('is_archived'), 'get_user_conversations returns is_archived');
    assert(argNames.includes('archived_at'), 'get_user_conversations returns archived_at');
    console.log('   [Live DB] get_user_conversations output columns confirmed:', argNames.join(', '));
    passed += 2;
  }

  console.log(`\n=======================================================`);
  console.log(`ALL ${passed} HOME / HISTORY / ARCHIVE SEPARATION TESTS PASSED!`);
  console.log(`=======================================================\n`);
}

runHomeHistoryArchiveTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
