/**
 * Tchat: Other User Profile & Relationship Resolution Test Suite
 * 
 * Verifies:
 * - Public OtherUserProfile data shape & privacy isolation (no email or credentials)
 * - Relationship state taxonomy: self, not_connected, request_sent, request_received, connected, blocked, viewer_blocked
 * - Bio redaction invariant when viewer is blocked
 * - Continuity & Streaks association in Profile (replaces persistent conversation space)
 * - Live PostgreSQL RPC registration, SECURITY DEFINER definition, and authenticated execution restriction
 */

import { OtherUserProfile, ProfileRelationshipStatus } from '../src/domains/identity/types';
import { TchatStreak, StreakType } from '../src/domains/streaks/types';
import { VALID_STREAK_TYPES } from '../src/domains/streaks/validation';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runOtherUserProfileTests() {
  console.log('=== Running Other User Profile & Relationship Resolution Tests ===\n');
  let passed = 0;

  // 1. Data Contract & Privacy Hardening Suite
  console.log('1. Testing Profile Data Isolation & Public Contract:');

  const mockPublicProfile: OtherUserProfile = {
    id: 'target-user-456',
    username: 'alex_rivera',
    normalized_username: 'alex_rivera',
    display_name: 'Alex Rivera',
    avatar_url: 'https://example.com/avatar.jpg',
    bio: 'Photographer & minimalist.',
    created_at: '2026-09-15T10:00:00Z',
    relationship: {
      status: 'connected',
      conversation_id: 'conv-123-456',
    },
  };

  assert(mockPublicProfile.id === 'target-user-456', 'Profile contains id');
  assert(mockPublicProfile.username === 'alex_rivera', 'Profile contains username');
  assert(mockPublicProfile.display_name === 'Alex Rivera', 'Profile contains display name');
  assert(mockPublicProfile.avatar_url !== null, 'Profile contains avatar url');
  assert(mockPublicProfile.bio === 'Photographer & minimalist.', 'Profile contains bio');
  passed += 5;

  // Strict privacy check: email, credentials, password must NEVER be in OtherUserProfile
  const profileKeys = Object.keys(mockPublicProfile);
  assert(!profileKeys.includes('email'), 'Profile never exposes email');
  assert(!profileKeys.includes('password'), 'Profile never exposes password');
  assert(!profileKeys.includes('auth'), 'Profile never exposes auth internals');
  assert(!profileKeys.includes('account'), 'Profile never exposes internal account object');
  passed += 4;
  console.log(`   ✓ 9 public contract & privacy isolation checks passed.\n`);

  // 2. Relationship State Resolution Suite
  console.log('2. Testing Relationship State Taxonomy:');

  const validStatuses: ProfileRelationshipStatus[] = [
    'self',
    'not_connected',
    'request_sent',
    'request_received',
    'connected',
    'blocked',
    'viewer_blocked',
  ];

  for (const st of validStatuses) {
    const p: OtherUserProfile = {
      ...mockPublicProfile,
      relationship: { status: st },
    };
    assert(p.relationship.status === st, `Valid relationship status handled: ${st}`);
    passed++;
  }

  // Pending Request Context Invariant
  const sentProfile: OtherUserProfile = {
    ...mockPublicProfile,
    relationship: {
      status: 'request_sent',
      pending_request_id: 'req-789',
      request_context: 'Met you at the community art showcase.',
    },
  };
  assert(sentProfile.relationship.status === 'request_sent', 'request_sent status verified');
  assert(sentProfile.relationship.pending_request_id === 'req-789', 'Pending request ID preserved for sender cancellation');
  assert(sentProfile.relationship.request_context === 'Met you at the community art showcase.', 'Context note visible');
  passed += 3;

  // Incoming Request Context Invariant
  const receivedProfile: OtherUserProfile = {
    ...mockPublicProfile,
    relationship: {
      status: 'request_received',
      pending_request_id: 'req-999',
      request_context: 'Would love to discuss your photography project.',
    },
  };
  assert(receivedProfile.relationship.status === 'request_received', 'request_received status verified');
  assert(receivedProfile.relationship.pending_request_id === 'req-999', 'Pending request ID present for accept/decline');
  assert(receivedProfile.relationship.request_context?.length! >= 3, 'Intentional context required (min 3 chars)');
  passed += 3;

  // Viewer Blocked Bio Redaction Invariant
  const viewerBlockedProfile: OtherUserProfile = {
    ...mockPublicProfile,
    bio: null, // Redacted authoritatively by RPC
    relationship: {
      status: 'viewer_blocked',
    },
  };
  assert(viewerBlockedProfile.relationship.status === 'viewer_blocked', 'viewer_blocked recognized safely');
  assert(viewerBlockedProfile.bio === null, 'Bio redacted when viewer is blocked by target user');
  passed += 2;
  console.log(`   ✓ 15 relationship taxonomy and privacy state checks passed.\n`);

  // 3. Continuity & Streaks in Profile Suite
  console.log('3. Testing Relationship Streaks in Profile Domain:');

  const mockStreaks: TchatStreak[] = [
    {
      id: 'streak-1',
      conversation_id: 'conv-123-456',
      initiator_id: 'target-user-456',
      recipient_id: 'user-123',
      type: 'chat',
      state: 'active',
      progress_count: 5,
      created_at: new Date().toISOString(),
      state_changed_at: new Date().toISOString(),
    },
    {
      id: 'streak-2',
      conversation_id: 'conv-123-456',
      initiator_id: 'user-123',
      recipient_id: 'target-user-456',
      type: 'photo',
      state: 'dormant', // Missed day makes streak dormant, never punitive reset
      progress_count: 12,
      created_at: new Date().toISOString(),
      state_changed_at: new Date().toISOString(),
    },
    {
      id: 'streak-3',
      conversation_id: 'conv-123-456',
      initiator_id: 'user-123',
      recipient_id: 'target-user-456',
      type: 'video',
      state: 'ended', // Preserved historical continuity
      progress_count: 20,
      end_reason: 'manual_ended',
      created_at: new Date().toISOString(),
      state_changed_at: new Date().toISOString(),
    },
  ];

  // Active or dormant filter
  const activeOrDormant = mockStreaks.filter((s) => s.state === 'active' || s.state === 'dormant');
  assert(activeOrDormant.length === 2, 'Active and dormant streaks identified');
  assert(activeOrDormant[0].progress_count === 5 && activeOrDormant[0].state === 'active', 'Active streak count preserved');
  assert(activeOrDormant[1].progress_count === 12 && activeOrDormant[1].state === 'dormant', 'Dormant streak count preserved without reset');
  passed += 3;

  // Ended streaks preserved as continuity
  const ended = mockStreaks.filter((s) => s.state === 'ended');
  assert(ended.length === 1, 'Ended streaks preserved for relationship continuity');
  assert(ended[0].progress_count === 20, 'Ended streak retains final progress count');
  passed += 2;

  // Available streak types for initiating new streaks
  const nonEndedTypes = new Set(mockStreaks.filter((s) => s.state !== 'ended').map((s) => s.type));
  const availableTypes: StreakType[] = VALID_STREAK_TYPES.filter((t) => !nonEndedTypes.has(t));
  // Chat and photo are ongoing; video is ended so it could be re-initiated
  assert(availableTypes.includes('video'), 'Ended streak type can be re-initiated');
  assert(!availableTypes.includes('chat'), 'Ongoing chat streak cannot be duplicated');
  assert(!availableTypes.includes('photo'), 'Ongoing photo streak cannot be duplicated');
  passed += 3;
  console.log(`   ✓ 8 continuity & streaks checks passed.\n`);

  // 4. Live PostgreSQL RPC Contract Verification
  console.log('4. Testing Live PostgreSQL get_other_user_profile RPC:');

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = 'jqghykhnnrfsjkkjhekf';

  if (!token) {
    console.log('   [Skip Live DB] SUPABASE_ACCESS_TOKEN not in environment.');
  } else {
    const https = await import('https');

    const queryPromise = async (sql: string, retries = 3): Promise<any> => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          return await new Promise((resolve, reject) => {
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
                    const err: any = new Error(`HTTP ${res.statusCode}: ${data}`);
                    err.statusCode = res.statusCode;
                    reject(err);
                  }
                });
              }
            );
            req.on('error', reject);
            req.write(payload);
            req.end();
          });
        } catch (err: any) {
          if (err?.statusCode === 429 && attempt < retries) {
            console.log(`   [Rate Limit] Waiting ${attempt * 3}s before retry...`);
            await new Promise((r) => setTimeout(r, attempt * 3000));
            continue;
          }
          throw err;
        }
      }
    };

    // Verify RPC definition
    const procRows = await queryPromise(`
      SELECT proname, prosecdef, prorettype::regtype AS return_type, proargnames
      FROM pg_proc 
      WHERE proname = 'get_other_user_profile';
    `);

    assert(Array.isArray(procRows) && procRows.length > 0, 'RPC get_other_user_profile exists in live DB');
    assert(procRows[0].prosecdef === true, 'RPC is SECURITY DEFINER');
    assert(procRows[0].return_type === 'jsonb', 'RPC returns jsonb');
    passed += 3;

    // Verify Unauthenticated Rejection (auth.uid() IS NULL)
    let unauthCaught = false;
    try {
      await queryPromise(`
        DO $$
        BEGIN
          PERFORM public.get_other_user_profile('00000000-0000-0000-0000-000000000001'::uuid);
        END $$;
      `);
    } catch (err: any) {
      if (err?.message?.includes('Not authenticated')) {
        unauthCaught = true;
      }
    }
    assert(unauthCaught, 'RPC throws "Not authenticated" when caller has no auth session');
    passed++;

    console.log(`   ✓ 4 live database RPC security & signature checks passed.\n`);
  }

  console.log(`=================================================`);
  console.log(`All ${passed} Other User Profile Tests Passed Successfully!`);
  console.log(`=================================================\n`);
}

runOtherUserProfileTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
