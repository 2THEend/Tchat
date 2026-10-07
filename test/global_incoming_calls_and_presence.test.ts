/**
 * Tchat: Global Incoming Calls + Presence Truthfulness Verification Suite
 *
 * Verifies:
 * 1. Pending incoming call detection without ConversationView mounted.
 * 2. Recipient isolation: authenticated recipient only receives their own incoming calls
 *    (never calls addressed to another user or initiated by themselves).
 * 3. Authoritative call state resolution (resolveGlobalIncomingCallState).
 * 4. Duplicate realtime event suppression (getCallEventDedupeKey + reference stability).
 * 5. Caller cancellation removes the incoming call prompt.
 * 6. Recipient decline removes the incoming call prompt.
 * 7. Expiration removes the incoming call prompt.
 * 8. Recipient acceptance removes the pending prompt and transitions to accepted state.
 * 9. Global listener lifecycle: mounts for authenticated user, prevents duplicate subscriptions,
 *    and cleans up on logout, account switch, or AppShell unmount.
 * 10. Presence Truthfulness: verifies both deceptive static green presence indicators
 *     in AppShell.tsx and FoundationView.tsx have been removed.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  isPendingIncomingCallForUser,
  getCallEventDedupeKey,
  resolveGlobalIncomingCallState,
} from '../src/domains/calls/validation';
import {
  subscribeToUserIncomingCalls,
  getActiveRecipientSubscriptionCount,
} from '../src/domains/calls/realtime';
import { TchatIncomingCall } from '../src/domains/calls/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runGlobalIncomingCallsAndPresenceTests() {
  console.log('=== Running Global Incoming Calls + Presence Truthfulness Tests ===\n');
  let passed = 0;

  const userA = '11111111-1111-1111-1111-111111111111'; // Caller
  const userB = '22222222-2222-2222-2222-222222222222'; // Recipient
  const userC = '33333333-3333-3333-3333-333333333333'; // Unrelated 3rd user
  const convId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const nowMs = new Date('2026-10-07T10:00:00Z').getTime();
  const futureExpiresAt = new Date(nowMs + 90_000).toISOString();
  const pastExpiresAt = new Date(nowMs - 5_000).toISOString();

  const basePendingIncomingCall: TchatIncomingCall = {
    id: 'call-001',
    conversation_id: convId,
    initiator_id: userA,
    recipient_id: userB,
    mode: 'immediate',
    preset_reason: 'quick_sync',
    custom_reason: 'Checking in while you are on Home',
    request_expires_at: futureExpiresAt,
    status: 'pending',
    outcome: null,
    started_at: null,
    ended_at: null,
    created_at: new Date(nowMs - 30_000).toISOString(),
    updated_at: new Date(nowMs - 30_000).toISOString(),
    caller_profile: {
      id: userA,
      username: 'alice',
      display_name: 'Alice',
      avatar_url: null,
    },
  };

  // --------------------------------------------------------------------------
  // 1. Pending Incoming Call Detection & Recipient Isolation
  // --------------------------------------------------------------------------
  console.log('1. Testing pending incoming call detection & recipient isolation...');

  // Recipient (User B) detects the pending incoming call without ConversationView
  assert(
    isPendingIncomingCallForUser(basePendingIncomingCall, userB, nowMs) === true,
    'Recipient User B must detect active pending incoming call'
  );
  passed++;

  // Initiator (User A) must NOT treat their own outgoing call as an incoming call prompt
  assert(
    isPendingIncomingCallForUser(basePendingIncomingCall, userA, nowMs) === false,
    'Caller User A must not treat their own outgoing call as an incoming prompt'
  );
  passed++;

  // Unrelated User C must NOT receive User B's incoming call
  assert(
    isPendingIncomingCallForUser(basePendingIncomingCall, userC, nowMs) === false,
    'Unrelated User C must not receive User B incoming call'
  );
  passed++;

  // Null/empty inputs handled safely
  assert(
    isPendingIncomingCallForUser(null, userB, nowMs) === false,
    'Null call must return false'
  );
  assert(
    isPendingIncomingCallForUser(basePendingIncomingCall, '', nowMs) === false,
    'Empty user ID must return false'
  );
  passed += 2;

  // --------------------------------------------------------------------------
  // 2. Authoritative Call State Resolution & Duplicate Realtime Event Handling
  // --------------------------------------------------------------------------
  console.log('2. Testing authoritative call state resolution & duplicate event suppression...');

  const initialState = resolveGlobalIncomingCallState(
    null,
    basePendingIncomingCall,
    userB,
    nowMs
  );
  assert(
    initialState === basePendingIncomingCall,
    'Initial pending incoming call is resolved into global prompt state'
  );
  passed++;

  // Duplicate realtime event with identical id, status, and updated_at preserves state reference
  const duplicateCandidate: TchatIncomingCall = {
    ...basePendingIncomingCall,
    caller_profile: { ...basePendingIncomingCall.caller_profile! },
  };
  const afterDuplicate = resolveGlobalIncomingCallState(
    initialState,
    duplicateCandidate,
    userB,
    nowMs
  );
  assert(
    afterDuplicate === initialState,
    'Duplicate realtime event for same call state preserves reference and prevents duplicate prompt'
  );
  passed++;

  // Deduplication key consistency
  const key1 = getCallEventDedupeKey(basePendingIncomingCall);
  const key2 = getCallEventDedupeKey(duplicateCandidate);
  assert(key1 === key2, 'Dedupe keys for identical call state transitions must match');
  passed++;

  // --------------------------------------------------------------------------
  // 3. Cancellation, Decline, Expiration & Acceptance Lifecycle Resolution
  // --------------------------------------------------------------------------
  console.log('3. Testing cancellation, decline, expiration, and acceptance state transitions...');

  // Caller cancellation removes the prompt
  const cancelledCall: TchatIncomingCall = {
    ...basePendingIncomingCall,
    status: 'cancelled',
    outcome: 'cancelled',
    updated_at: new Date(nowMs + 1_000).toISOString(),
  };
  assert(
    resolveGlobalIncomingCallState(initialState, cancelledCall, userB, nowMs) === null,
    'Caller cancellation immediately removes global incoming call prompt'
  );
  passed++;

  // Recipient decline removes the prompt
  const declinedCall: TchatIncomingCall = {
    ...basePendingIncomingCall,
    status: 'declined',
    outcome: 'declined',
    updated_at: new Date(nowMs + 2_000).toISOString(),
  };
  assert(
    resolveGlobalIncomingCallState(initialState, declinedCall, userB, nowMs) === null,
    'Recipient decline immediately removes global incoming call prompt'
  );
  passed++;

  // Expiration (by status = expired) removes the prompt
  const expiredStatusCall: TchatIncomingCall = {
    ...basePendingIncomingCall,
    status: 'expired',
    outcome: 'expired',
    updated_at: new Date(nowMs + 3_000).toISOString(),
  };
  assert(
    resolveGlobalIncomingCallState(initialState, expiredStatusCall, userB, nowMs) === null,
    'Status=expired immediately removes global incoming call prompt'
  );
  passed++;

  // Expiration (by timestamp elapsed even if status is still pending) removes the prompt
  const expiredTimestampCall: TchatIncomingCall = {
    ...basePendingIncomingCall,
    status: 'pending',
    request_expires_at: pastExpiresAt,
  };
  assert(
    resolveGlobalIncomingCallState(initialState, expiredTimestampCall, userB, nowMs) === null,
    'Elapsed request_expires_at timestamp immediately removes global incoming call prompt'
  );
  passed++;

  // Acceptance removes the pending prompt so ConversationView + ActiveCallSession take over
  const acceptedCall: TchatIncomingCall = {
    ...basePendingIncomingCall,
    status: 'accepted',
    updated_at: new Date(nowMs + 4_000).toISOString(),
  };
  assert(
    resolveGlobalIncomingCallState(initialState, acceptedCall, userB, nowMs) === null,
    'Acceptance removes global pending call prompt so ActiveCallSession takes over without duplication'
  );
  passed++;

  // Ended / connecting / connected calls never show as pending incoming prompts
  for (const terminalOrActiveStatus of ['connecting', 'connected', 'ended', 'failed'] as const) {
    const nonPendingCall: TchatIncomingCall = {
      ...basePendingIncomingCall,
      status: terminalOrActiveStatus,
    };
    assert(
      resolveGlobalIncomingCallState(initialState, nonPendingCall, userB, nowMs) === null,
      `Call in status '${terminalOrActiveStatus}' must not display as a pending incoming prompt`
    );
    passed++;
  }

  // --------------------------------------------------------------------------
  // 4. Global Listener Lifecycle (Mount, Deduplication, User Switch, Logout Cleanup)
  // --------------------------------------------------------------------------
  console.log('4. Testing global listener lifecycle & cleanup...');

  assert(
    getActiveRecipientSubscriptionCount() === 0,
    'Initially zero active global recipient subscriptions'
  );
  passed++;

  // Mount listener for User B
  const unsubB1 = subscribeToUserIncomingCalls(userB, {});
  assert(
    getActiveRecipientSubscriptionCount() === 1,
    'Mounting listener for User B registers 1 active subscription'
  );
  passed++;

  // Re-subscribing for the same user replaces the previous subscription instead of duplicating
  const unsubB2 = subscribeToUserIncomingCalls(userB, {});
  assert(
    getActiveRecipientSubscriptionCount() === 1,
    'Re-subscribing for User B prevents duplicate subscriptions (count remains 1)'
  );
  passed++;

  // Calling the old cleanup after replacement is a safe no-op
  unsubB1();
  assert(
    getActiveRecipientSubscriptionCount() === 1,
    'Stale cleanup function does not remove replaced active subscription'
  );
  passed++;

  // Account switch: User B logs out / unmounts and User A mounts
  unsubB2();
  assert(
    getActiveRecipientSubscriptionCount() === 0,
    'Unsubscribing User B on logout/unmount cleans up subscription (count = 0)'
  );
  passed++;

  const unsubA = subscribeToUserIncomingCalls(userA, {});
  assert(
    getActiveRecipientSubscriptionCount() === 1,
    'Mounting listener for switched User A registers 1 active subscription'
  );
  unsubA();
  // Calling cleanup twice is idempotent
  unsubA();
  assert(
    getActiveRecipientSubscriptionCount() === 0,
    'Idempotent cleanup on unmount leaves 0 active subscriptions'
  );
  passed += 2;

  // --------------------------------------------------------------------------
  // 5. Architectural & Presence Truthfulness Verification
  // --------------------------------------------------------------------------
  console.log('5. Verifying AppShell global call integration & Presence Truthfulness...');

  const appShellPath = path.resolve(process.cwd(), 'src/components/shell/AppShell.tsx');
  const foundationViewPath = path.resolve(process.cwd(), 'src/components/foundation/FoundationView.tsx');
  const globalBannerPath = path.resolve(
    process.cwd(),
    'src/components/conversations/calls/GlobalIncomingCallBanner.tsx'
  );

  const appShellSource = fs.readFileSync(appShellPath, 'utf8');
  const foundationViewSource = fs.readFileSync(foundationViewPath, 'utf8');
  const globalBannerSource = fs.readFileSync(globalBannerPath, 'utf8');

  // Verify AppShell mounts global incoming call listener and banner
  assert(
    appShellSource.includes('subscribeToUserIncomingCalls'),
    'AppShell must subscribe to global incoming calls via subscribeToUserIncomingCalls'
  );
  assert(
    appShellSource.includes('getPendingIncomingCallForUser'),
    'AppShell must resolve authoritative incoming call state via getPendingIncomingCallForUser'
  );
  assert(
    appShellSource.includes('<GlobalIncomingCallBanner'),
    'AppShell must render GlobalIncomingCallBanner at the application shell level'
  );
  passed += 3;

  // Verify GlobalIncomingCallBanner uses existing respondToCall domain logic
  assert(
    globalBannerSource.includes('respondToCall') &&
      globalBannerSource.includes("respondToCall(call.id, 'accept')") &&
      globalBannerSource.includes("respondToCall(call.id, 'decline')"),
    'GlobalIncomingCallBanner must use existing respondToCall domain service for accept and decline'
  );
  passed++;

  // Verify deceptive static green presence dot is removed from AppShell header
  const headerMatch = appShellSource.match(/id="app-status-header"[\s\S]*?<\/header>/g) || [];
  for (const headerBlock of headerMatch) {
    assert(
      !headerBlock.includes('bg-emerald-400'),
      'AppShell #app-status-header must not contain a deceptive static green presence dot'
    );
  }
  passed++;

  // Verify deceptive static pulsing green dot is removed from FoundationView
  assert(
    !foundationViewSource.includes('bg-emerald-400 animate-pulse'),
    'FoundationView must not contain a deceptive static pulsing green indicator'
  );
  passed++;

  console.log(`\n=======================================================`);
  console.log(`ALL ${passed} GLOBAL INCOMING CALLS & PRESENCE TESTS PASSED!`);
  console.log(`=======================================================\n`);
}

runGlobalIncomingCallsAndPresenceTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
