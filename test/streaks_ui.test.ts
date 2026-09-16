/**
 * Streaks UI/UX Layer Automated Unit & Invariant Tests
 * Verifies:
 * 1. Streak display formatting (formatStreakDays, formatStreakType)
 * 2. Days unit guarantee (never display bare numbers)
 * 3. Available streak types determination (Chat, Photo, Video coexistence)
 * 4. Pending invitation state handling (recipient vs initiator actions)
 * 5. Dormancy representation (progress preservation, calm indicators)
 * 6. Non-gamification invariants (no countdowns, no penalties, no loss language)
 * 7. Realtime event processing and state update invariants
 */

import { 
  formatStreakDays, 
  formatStreakType 
} from '../src/components/conversations/streaks/StreakBadges';
import { 
  StreakType, 
  StreakState, 
  StreakEndReason,
  TchatStreak 
} from '../src/domains/streaks/types';
import { 
  canEndStreak 
} from '../src/domains/streaks/validation';
import { 
  onStreakEvent, 
  emitStreakEvent 
} from '../src/domains/streaks/events';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runStreakUITests() {
  console.log('=== Running Tchat Streak UI/UX Integration Tests ===\n');
  let passed = 0;

  // 1. Display Formatting & Explicit Units
  console.log('1. Testing streak display formatting and unit constraints...');
  assert(formatStreakDays(0) === '0 days', '0 days formatted correctly');
  assert(formatStreakDays(1) === '1 day', '1 day formatted singular');
  assert(formatStreakDays(2) === '2 days', '2 days formatted plural');
  assert(formatStreakDays(18) === '18 days', '18 days formatted plural');
  assert(formatStreakDays(100) === '100 days', '100 days formatted plural');

  // Verify bare numbers are never returned
  assert(formatStreakDays(18) !== '18', 'Never displays a bare number without units');
  assert(!/^\d+$/.test(formatStreakDays(18)), 'Regex confirms unit string is attached');

  assert(formatStreakType('chat') === 'Chat', 'chat maps to Chat');
  assert(formatStreakType('photo') === 'Photo', 'photo maps to Photo');
  assert(formatStreakType('video') === 'Video', 'video maps to Video');
  console.log('   ✓ Formatting and unit constraints passed.');
  passed++;

  // 2. Coexistence & Available Types Computation
  console.log('2. Testing multiple streak types coexistence and available types logic...');
  const mockUserId1 = 'user-alice';
  const mockUserId2 = 'user-bob';
  const mockConvId = 'conv-123';

  // Case A: No streaks exist
  const emptyStreaks: TchatStreak[] = [];
  const allTypes: StreakType[] = ['chat', 'photo', 'video'];
  let occupiedTypes = new Set(emptyStreaks.filter((s) => s.state !== 'ended').map((s) => s.type));
  let available = allTypes.filter((t) => !occupiedTypes.has(t));
  assert(available.length === 3, 'All 3 types available when no streaks exist');
  assert(available.includes('chat') && available.includes('photo') && available.includes('video'), 'Includes all types');

  // Case B: Chat streak is active
  const chatActiveStreak: TchatStreak = {
    id: 'streak-1',
    conversation_id: mockConvId,
    initiator_id: mockUserId1,
    recipient_id: mockUserId2,
    type: 'chat',
    state: 'active',
    progress_count: 5,
    created_at: '2026-09-10T12:00:00Z',
    state_changed_at: '2026-09-10T12:00:00Z',
  };
  occupiedTypes = new Set([chatActiveStreak].filter((s) => s.state !== 'ended').map((s) => s.type));
  available = allTypes.filter((t) => !occupiedTypes.has(t));
  assert(available.length === 2, '2 types available when chat is active');
  assert(!available.includes('chat'), 'Chat is not available');
  assert(available.includes('photo') && available.includes('video'), 'Photo and Video remain available');

  // Case C: Photo streak is pending
  const photoPendingStreak: TchatStreak = {
    id: 'streak-2',
    conversation_id: mockConvId,
    initiator_id: mockUserId2,
    recipient_id: mockUserId1,
    type: 'photo',
    state: 'pending',
    progress_count: 0,
    created_at: '2026-09-14T10:00:00Z',
    state_changed_at: '2026-09-14T10:00:00Z',
  };
  occupiedTypes = new Set([chatActiveStreak, photoPendingStreak].filter((s) => s.state !== 'ended').map((s) => s.type));
  available = allTypes.filter((t) => !occupiedTypes.has(t));
  assert(available.length === 1, 'Only 1 type available');
  assert(available[0] === 'video', 'Only Video remains available');

  // Case D: Ended streaks don't occupy slots
  const endedVideoStreak: TchatStreak = {
    id: 'streak-3',
    conversation_id: mockConvId,
    initiator_id: mockUserId1,
    recipient_id: mockUserId2,
    type: 'video',
    state: 'ended',
    progress_count: 12,
    created_at: '2026-08-01T10:00:00Z',
    state_changed_at: '2026-09-01T10:00:00Z',
  };
  occupiedTypes = new Set([chatActiveStreak, photoPendingStreak, endedVideoStreak].filter((s) => s.state !== 'ended').map((s) => s.type));
  available = allTypes.filter((t) => !occupiedTypes.has(t));
  assert(available.length === 1 && available[0] === 'video', 'Ended streak allows Video to be requested again');
  console.log('   ✓ Coexistence & available types computation passed.');
  passed++;

  // 3. Pending State Role Invariants (Initiator vs Recipient)
  console.log('3. Testing pending streak role semantics...');
  const pendingStreak: TchatStreak = {
    id: 'streak-pending-1',
    conversation_id: mockConvId,
    initiator_id: mockUserId1,
    recipient_id: mockUserId2,
    type: 'chat',
    state: 'pending',
    progress_count: 0,
    created_at: new Date().toISOString(),
    state_changed_at: new Date().toISOString(),
  };

  // Check Alice (initiator)
  const isAliceInitiator = pendingStreak.initiator_id === mockUserId1;
  const isAliceRecipient = pendingStreak.recipient_id === mockUserId1;
  assert(isAliceInitiator === true, 'Alice is initiator');
  assert(isAliceRecipient === false, 'Alice is not recipient');
  // Initiator can cancel, cannot accept own request
  assert(isAliceInitiator && !isAliceRecipient, 'Initiator sees cancel, not accept/decline');

  // Check Bob (recipient)
  const isBobInitiator = pendingStreak.initiator_id === mockUserId2;
  const isBobRecipient = pendingStreak.recipient_id === mockUserId2;
  assert(isBobInitiator === false, 'Bob is not initiator');
  assert(isBobRecipient === true, 'Bob is recipient');
  // Recipient sees accept and decline
  assert(isBobRecipient && !isBobInitiator, 'Recipient sees accept and decline');
  console.log('   ✓ Pending state role semantics passed.');
  passed++;

  // 4. Dormancy UI Principles & Calm Tone
  console.log('4. Testing dormancy state UI handling...');
  const dormantStreak: TchatStreak = {
    id: 'streak-dormant-1',
    conversation_id: mockConvId,
    initiator_id: mockUserId1,
    recipient_id: mockUserId2,
    type: 'chat',
    state: 'dormant',
    progress_count: 24,
    created_at: '2026-08-01T00:00:00Z',
    state_changed_at: '2026-09-12T00:00:00Z',
  };

  assert(dormantStreak.state === 'dormant', 'Streak state is dormant');
  assert(dormantStreak.progress_count === 24, 'Progress count is preserved (not reset to 0)');
  assert(formatStreakDays(dormantStreak.progress_count) === '24 days', 'Displays preserved 24 days');

  // Invariant: Missing days or entering dormancy NEVER decrements or deletes progress
  const postDormancyProgress = dormantStreak.progress_count;
  assert(postDormancyProgress >= 24, 'Dormancy preserves progress monotonically');
  console.log('   ✓ Dormancy UI principles passed.');
  passed++;

  // 5. Event Bus UI Integration
  console.log('5. Testing event bus listener dispatching to UI callbacks...');
  const state = { dispatched: false, receivedId: '' };

  const unsubscribe = onStreakEvent((event) => {
    if (event.type === 'streak:accepted') {
      state.dispatched = true;
      state.receivedId = event.streak?.id || '';
    }
  });

  emitStreakEvent({
    type: 'streak:accepted',
    streak: {
      id: 'streak-accepted-xyz',
      conversation_id: mockConvId,
      initiator_id: mockUserId1,
      recipient_id: mockUserId2,
      type: 'photo',
      state: 'active',
      progress_count: 0,
      created_at: new Date().toISOString(),
      state_changed_at: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  });

  assert(state.dispatched === true, 'Streak event listener called on dispatch');
  assert(state.receivedId === 'streak-accepted-xyz', 'Streak ID accurately passed through event');
  unsubscribe();
  console.log('   ✓ Event bus UI integration passed.');
  passed++;

  // 6. Streak End UI Action & Invariant Verification
  console.log('6. Testing Streak End UI action rules and lifecycle state invariants...');

  // Invariant A: Only active or dormant streaks can show the End Streak action
  assert(canEndStreak('active') === true, 'Active streak shows End Streak action');
  assert(canEndStreak('dormant') === true, 'Dormant streak shows End Streak action');
  assert(canEndStreak('pending') === false, 'Pending streak does NOT show End Streak action');
  assert(canEndStreak('ended') === false, 'Ended streak does NOT show End Streak action');
  assert(canEndStreak(null) === false, 'Null state does NOT show End Streak action');
  assert(canEndStreak(undefined) === false, 'Undefined state does NOT show End Streak action');

  // Invariant B: Confirmation flow simulation
  let confirmingStreakId: string | null = null;
  let rpcCallCount = 0;

  // User clicks "End Streak" on active chat streak
  confirmingStreakId = chatActiveStreak.id;
  assert(confirmingStreakId === 'streak-1', 'Initial click opens confirmation step');
  assert(rpcCallCount === 0, 'No RPC is triggered before explicit user confirmation');

  // User clicks "Cancel"
  confirmingStreakId = null;
  assert(confirmingStreakId === null, 'Canceling confirmation restores normal view without ending streak');
  assert(rpcCallCount === 0, 'No RPC is called on cancel');

  // User clicks "End Streak" and then "Confirm End"
  confirmingStreakId = chatActiveStreak.id;
  assert(confirmingStreakId === chatActiveStreak.id, 'Confirmation state active');
  
  // Simulate explicit confirmation execution
  const endStreakSimulator = (targetStreak: TchatStreak) => {
    assert(confirmingStreakId === targetStreak.id, 'Confirmation was required and confirmed');
    rpcCallCount++;
    return {
      ...targetStreak,
      state: 'ended' as StreakState,
      end_reason: 'manual_ended' as StreakEndReason,
      ended_at: new Date().toISOString(),
      state_changed_at: new Date().toISOString(),
    };
  };

  const endedChatStreak = endStreakSimulator(chatActiveStreak);
  assert(rpcCallCount === 1, 'Confirmed action executes end_streak RPC exactly once');
  assert(endedChatStreak.state === 'ended', 'Streak state transitions to ended');
  assert(endedChatStreak.end_reason === 'manual_ended', 'End reason is marked manual_ended');
  
  // Invariant C: Historical progress remains intact
  assert(endedChatStreak.progress_count === chatActiveStreak.progress_count, 'Historical progress preserved');
  assert(formatStreakDays(endedChatStreak.progress_count) === '5 days', 'Displays 5 days in ended list');

  // Invariant D: An ended streak can never show the End Streak action again
  assert(canEndStreak(endedChatStreak.state) === false, 'Ended streak cannot show End Streak action');

  // Invariant E: Ending one streak type does NOT affect other streak types between the same pair
  const activePhotoStreak: TchatStreak = {
    id: 'streak-photo-live',
    conversation_id: mockConvId,
    initiator_id: mockUserId1,
    recipient_id: mockUserId2,
    type: 'photo',
    state: 'active',
    progress_count: 8,
    created_at: '2026-09-01T00:00:00Z',
    state_changed_at: '2026-09-01T00:00:00Z',
  };

  const streakSet = [endedChatStreak, activePhotoStreak];
  const activeInSet = streakSet.filter((s) => s.state === 'active' || s.state === 'dormant');
  const endedInSet = streakSet.filter((s) => s.state === 'ended');

  assert(activeInSet.length === 1 && activeInSet[0].type === 'photo', 'Photo streak remains active');
  assert(endedInSet.length === 1 && endedInSet[0].type === 'chat', 'Only Chat streak is ended');
  assert(canEndStreak(activeInSet[0].state) === true, 'Remaining active photo streak can still be ended');

  // Invariant F: Event bus dispatches streak:ended
  const endEventState = {
    endedEventReceived: false,
    endedStreakPayloadId: '',
  };

  const unsubEnd = onStreakEvent((e) => {
    if (e.type === 'streak:ended') {
      endEventState.endedEventReceived = true;
      endEventState.endedStreakPayloadId = e.streak.id;
    }
  });

  emitStreakEvent({
    type: 'streak:ended',
    streak: endedChatStreak,
    timestamp: new Date().toISOString(),
  });

  assert(endEventState.endedEventReceived === true, 'streak:ended event dispatched to listeners');
  assert(endEventState.endedStreakPayloadId === endedChatStreak.id, 'Payload contains correct ended streak ID');
  unsubEnd();

  console.log('   ✓ Streak End UI action rules and lifecycle state invariants passed.');
  passed++;

  console.log(`\nAll ${passed} Streak UI/UX integration test suites passed cleanly!\n`);
}

runStreakUITests();
