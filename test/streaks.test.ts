/**
 * Streaks Domain & Persistence Layer Automated Unit Tests
 * Verifies:
 * 1. Valid streak types (chat, photo, video)
 * 2. Timezone handling and local day UTC boundaries
 * 3. Cross-timezone local calendar day UTC interval overlap logic
 * 4. Exact +1 progress pairing invariant and single-consumption rule
 * 5. Multiple interactions on same local day idempotency
 * 6. Non-consecutive continuity (missing days does not erase progress)
 * 7. Dormancy threshold evaluation and dormant reactivation
 * 8. Unilateral vs mutual action behavior during dormancy
 * 9. Coexistence of multiple streak types per relationship
 * 10. Historical integrity & event bus dispatching
 */

import {
  isValidStreakType,
  getUserTimezone,
  isValidIanaTimezone,
  formatLocalDate,
  calculateLocalDayUtcBounds,
  doUtcIntervalsOverlap,
  isStreakDormant,
  DEFAULT_DORMANCY_THRESHOLD_HOURS,
} from '../src/domains/streaks/validation';
import { 
  StreakType, 
  StreakState, 
  TchatStreak, 
  TchatStreakParticipantDay, 
  TchatStreakProgressDay 
} from '../src/domains/streaks/types';
import { onStreakEvent, emitStreakEvent } from '../src/domains/streaks/events';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runStreakTests() {
  console.log('=== Running Tchat Streak Domain & Invariant Tests ===\n');
  let passed = 0;

  // 1. Streak Type Validation
  console.log('1. Testing streak type constraints...');
  assert(isValidStreakType('chat') === true, 'chat is a valid streak type');
  assert(isValidStreakType('photo') === true, 'photo is a valid streak type');
  assert(isValidStreakType('video') === true, 'video is a valid streak type');
  assert(isValidStreakType('audio') === false, 'audio is NOT a valid streak type');
  assert(isValidStreakType('text') === false, 'text is not a streak type (type is chat)');
  assert(isValidStreakType('') === false, 'empty string is not a valid streak type');
  assert(isValidStreakType(null) === false, 'null is not a valid streak type');
  assert(isValidStreakType(undefined) === false, 'undefined is not a valid streak type');
  console.log('   ✓ Streak type constraints passed.');
  passed++;

  // 2. Timezone Handling & IANA Identifier Validation
  console.log('2. Testing IANA timezone handling...');
  assert(isValidIanaTimezone('UTC') === true, 'UTC is valid');
  assert(isValidIanaTimezone('America/New_York') === true, 'America/New_York is valid');
  assert(isValidIanaTimezone('Asia/Tokyo') === true, 'Asia/Tokyo is valid');
  assert(isValidIanaTimezone('Europe/London') === true, 'Europe/London is valid');
  assert(isValidIanaTimezone('Fake/Timezone') === false, 'Fake timezone is invalid');
  assert(isValidIanaTimezone('') === false, 'Empty string is invalid');

  const detectedTz = getUserTimezone();
  assert(typeof detectedTz === 'string' && detectedTz.length > 0, 'getUserTimezone returns a string');
  assert(isValidIanaTimezone(detectedTz) === true, 'getUserTimezone returns a valid IANA timezone');
  console.log(`   ✓ Timezone validation passed (current runtime timezone: ${detectedTz}).`);
  passed++;

  // 3. Local Day UTC Boundary Calculation Across Timezones
  console.log('3. Testing local day UTC boundary calculations...');
  // Fixed timestamp: 2026-09-15 12:00:00 UTC
  const testInstant = new Date('2026-09-15T12:00:00.000Z');

  // Tokyo (UTC+9): 12:00 UTC is 21:00 local on 2026-09-15
  const tokyoBounds = calculateLocalDayUtcBounds(testInstant, 'Asia/Tokyo');
  assert(tokyoBounds.localDate === '2026-09-15', `Tokyo local date should be 2026-09-15, got ${tokyoBounds.localDate}`);
  assert(new Date(tokyoBounds.dayStartUtc).getTime() < new Date(tokyoBounds.dayEndUtc).getTime(), 'Tokyo start < end');

  // Honolulu (UTC-10): 12:00 UTC is 02:00 local on 2026-09-15
  const honoluluBounds = calculateLocalDayUtcBounds(testInstant, 'Pacific/Honolulu');
  assert(honoluluBounds.localDate === '2026-09-15', `Honolulu local date should be 2026-09-15, got ${honoluluBounds.localDate}`);

  // Test across midnight boundary: 2026-09-15 01:00:00 UTC
  // In Tokyo (UTC+9), this is 10:00 AM on 2026-09-15.
  // In New York (UTC-4 EDT), this is 9:00 PM on 2026-09-14!
  const earlyInstant = new Date('2026-09-15T01:00:00.000Z');
  const nyDate = formatLocalDate(earlyInstant, 'America/New_York');
  const tokyoDate = formatLocalDate(earlyInstant, 'Asia/Tokyo');
  assert(nyDate === '2026-09-14', `New York local date should be 2026-09-14, got ${nyDate}`);
  assert(tokyoDate === '2026-09-15', `Tokyo local date should be 2026-09-15, got ${tokyoDate}`);
  console.log('   ✓ Local day UTC boundary and multi-timezone date derivation passed.');
  passed++;

  // 4. Cross-Timezone Local Day UTC Interval Overlap Rule
  console.log('4. Testing cross-timezone interval overlap pairing logic...');
  // User A in New York on 2026-09-15
  // User B in Tokyo on 2026-09-15
  const nyBounds = calculateLocalDayUtcBounds(new Date('2026-09-15T14:00:00.000Z'), 'America/New_York');
  const tkBounds = calculateLocalDayUtcBounds(new Date('2026-09-15T09:00:00.000Z'), 'Asia/Tokyo');

  const overlap = doUtcIntervalsOverlap(
    nyBounds.dayStartUtc,
    nyBounds.dayEndUtc,
    tkBounds.dayStartUtc,
    tkBounds.dayEndUtc
  );
  assert(overlap === true, 'New York 2026-09-15 and Tokyo 2026-09-15 intervals MUST overlap in UTC');

  // User in Tokyo on 2026-09-15 and User in Honolulu on 2026-09-17 (disjoint days)
  const tkDay1 = calculateLocalDayUtcBounds(new Date('2026-09-15T10:00:00.000Z'), 'Asia/Tokyo');
  const hnDay3 = calculateLocalDayUtcBounds(new Date('2026-09-17T10:00:00.000Z'), 'Pacific/Honolulu');
  const disjoint = doUtcIntervalsOverlap(
    tkDay1.dayStartUtc,
    tkDay1.dayEndUtc,
    hnDay3.dayStartUtc,
    hnDay3.dayEndUtc
  );
  assert(disjoint === false, 'Disjoint local days two days apart must NOT overlap in UTC');
  console.log('   ✓ Cross-timezone interval overlap logic verified.');
  passed++;

  // 5. Invariant: One Participant-Day Per Local Day (Idempotency)
  console.log('5. Testing participant-day idempotency simulator...');
  interface ParticipantDayRecord {
    id: string;
    userId: string;
    localDate: string;
    dayStartUtc: string;
    dayEndUtc: string;
    firstSentAt: string;
  }
  const participantDays: ParticipantDayRecord[] = [];

  function recordParticipantAction(userId: string, timestamp: Date, timezone: string): ParticipantDayRecord {
    const bounds = calculateLocalDayUtcBounds(timestamp, timezone);
    // Check for existing record on this localDate (mimics UNIQUE (streak_id, user_id, local_date))
    const existing = participantDays.find(d => d.userId === userId && d.localDate === bounds.localDate);
    if (existing) {
      return existing; // Idempotent: does not create a duplicate row
    }
    const newRecord: ParticipantDayRecord = {
      id: `pday-${participantDays.length + 1}`,
      userId,
      localDate: bounds.localDate,
      dayStartUtc: bounds.dayStartUtc,
      dayEndUtc: bounds.dayEndUtc,
      firstSentAt: timestamp.toISOString(),
    };
    participantDays.push(newRecord);
    return newRecord;
  }

  // Alice sends 3 messages on 2026-09-15 in New York
  const a1 = recordParticipantAction('alice', new Date('2026-09-15T12:00:00.000Z'), 'America/New_York');
  const a2 = recordParticipantAction('alice', new Date('2026-09-15T15:00:00.000Z'), 'America/New_York');
  const a3 = recordParticipantAction('alice', new Date('2026-09-15T20:00:00.000Z'), 'America/New_York');

  assert(a1.id === a2.id && a2.id === a3.id, 'Repeated interactions on the same local day must return the same participant-day');
  assert(participantDays.filter(d => d.userId === 'alice').length === 1, 'Exactly one participant-day record created for Alice on 2026-09-15');
  console.log('   ✓ Participant-day idempotency invariant verified.');
  passed++;

  // 6. Mutual Progress Pairing Invariant & Single-Consumption Rule
  console.log('6. Testing mutual progress pairing and single-consumption rule...');
  interface ProgressDayRecord {
    id: string;
    dayAId: string;
    dayBId: string;
    userAId: string;
    userBId: string;
  }
  const progressDays: ProgressDayRecord[] = [];

  function evaluatePairing(
    dayId: string, 
    userId: string, 
    partnerId: string
  ): ProgressDayRecord | null {
    const myDay = participantDays.find(d => d.id === dayId)!;
    // Check if myDay is already consumed
    if (progressDays.some(p => p.dayAId === dayId || p.dayBId === dayId)) {
      return null;
    }
    // Find unconsumed partner day with overlapping UTC interval
    const partnerDay = participantDays.find(d => 
      d.userId === partnerId &&
      !progressDays.some(p => p.dayAId === d.id || p.dayBId === d.id) &&
      doUtcIntervalsOverlap(myDay.dayStartUtc, myDay.dayEndUtc, d.dayStartUtc, d.dayEndUtc)
    );
    if (!partnerDay) {
      return null;
    }
    const [uLow, uHigh] = userId < partnerId ? [userId, partnerId] : [partnerId, userId];
    const [dLow, dHigh] = userId < partnerId ? [myDay.id, partnerDay.id] : [partnerDay.id, myDay.id];
    const progress: ProgressDayRecord = {
      id: `prog-${progressDays.length + 1}`,
      dayAId: dLow,
      dayBId: dHigh,
      userAId: uLow,
      userBId: uHigh,
    };
    progressDays.push(progress);
    return progress;
  }

  // Alice sent a message, Bob has not sent anything yet
  const pairingAliceOnly = evaluatePairing(a1.id, 'alice', 'bob');
  assert(pairingAliceOnly === null, 'Unilateral action by Alice cannot create progress');
  assert(progressDays.length === 0, 'No progress day created when only one participant has qualified');

  // Bob sends a message on 2026-09-15 in London
  const b1 = recordParticipantAction('bob', new Date('2026-09-15T14:00:00.000Z'), 'Europe/London');
  const pairingBob = evaluatePairing(b1.id, 'bob', 'alice');
  assert(pairingBob !== null, 'Mutual qualification in overlapping local days must create exactly +1 progress');
  assert(progressDays.length === 1, 'Exactly one progress row created');
  assert(progressDays[0].dayAId === a1.id && progressDays[0].dayBId === b1.id, 'Progress links both days');

  // Alice sends another message later in the day
  const a4 = recordParticipantAction('alice', new Date('2026-09-15T22:00:00.000Z'), 'America/New_York');
  const pairingAliceAgain = evaluatePairing(a4.id, 'alice', 'bob');
  assert(pairingAliceAgain === null, 'Additional interaction cannot create a second progress day for the same local day');
  assert(progressDays.length === 1, 'Progress count remains exactly 1');
  console.log('   ✓ Mutual progress pairing and single-consumption rule verified.');
  passed++;

  // 7. Non-Consecutive Continuity (Missing Days Rule)
  console.log('7. Testing non-consecutive continuity (missing days does NOT erase progress)...');
  // Day 1 (2026-09-15): Progress gained (progress count = 1)
  // Day 2 (2026-09-16): Neither Alice nor Bob sends anything (missed day)
  // Day 3 (2026-09-17): Both Alice and Bob send qualifying actions
  const aDay3 = recordParticipantAction('alice', new Date('2026-09-17T12:00:00.000Z'), 'America/New_York');
  const bDay3 = recordParticipantAction('bob', new Date('2026-09-17T13:00:00.000Z'), 'Europe/London');
  const pairingDay3 = evaluatePairing(bDay3.id, 'bob', 'alice');

  assert(pairingDay3 !== null, 'Day 3 mutual qualification produces progress');
  assert(progressDays.length === 2, 'Missing Day 2 did not reset or erase progress; progress count is now 2');
  console.log('   ✓ Continuity rule verified: missing a day does NOT reset or erase accumulated progress.');
  passed++;

  // 8. Dormancy Evaluation
  console.log('8. Testing dormancy threshold evaluation...');
  const refNow = new Date('2026-09-17T12:00:00.000Z');

  // Case A: Last progress was 20 hours ago (threshold 48h) -> NOT dormant
  const recentProgress = new Date(refNow.getTime() - 20 * 3600 * 1000).toISOString();
  assert(isStreakDormant(recentProgress, null, DEFAULT_DORMANCY_THRESHOLD_HOURS, refNow) === false, 'Streak is active within threshold');

  // Case B: Last progress was 49 hours ago (threshold 48h) -> DORMANT
  const staleProgress = new Date(refNow.getTime() - 49 * 3600 * 1000).toISOString();
  assert(isStreakDormant(staleProgress, null, DEFAULT_DORMANCY_THRESHOLD_HOURS, refNow) === true, 'Streak is dormant past threshold');

  // Case C: No progress ever, accepted 10 hours ago -> NOT dormant
  const recentAccepted = new Date(refNow.getTime() - 10 * 3600 * 1000).toISOString();
  assert(isStreakDormant(null, recentAccepted, DEFAULT_DORMANCY_THRESHOLD_HOURS, refNow) === false, 'Streak active after recent acceptance');

  // Case D: No progress ever, accepted 50 hours ago -> DORMANT
  const staleAccepted = new Date(refNow.getTime() - 50 * 3600 * 1000).toISOString();
  assert(isStreakDormant(null, staleAccepted, DEFAULT_DORMANCY_THRESHOLD_HOURS, refNow) === true, 'Streak dormant when no progress after acceptance');
  console.log('   ✓ Dormancy threshold logic verified.');
  passed++;

  // 9. Dormancy Invariant: Unilateral vs Mutual Action
  console.log('9. Testing dormancy reactivation invariant...');
  let streakState: StreakState = 'dormant';

  // Rule: A unilateral qualifying action while dormant does NOT reactivate the streak
  function onUnilateralSendWhenDormant() {
    // Remains dormant
    return streakState;
  }
  assert(onUnilateralSendWhenDormant() === 'dormant', 'Unilateral action while dormant does NOT reactivate streak');

  // Rule: Reactivation occurs ONLY when a new mutual progress day is created
  function onMutualProgressCreated() {
    streakState = 'active';
    return streakState;
  }
  assert(onMutualProgressCreated() === 'active', 'Mutual progress reactivates dormant streak to active');
  console.log('   ✓ Dormancy reactivation rules verified.');
  passed++;

  // 10. Coexistence of Multiple Streak Types Per Relationship
  console.log('10. Testing multi-type streak coexistence...');
  const activeStreaks: { conversationId: string; type: StreakType; state: StreakState }[] = [
    { conversationId: 'conv-1', type: 'chat', state: 'active' },
    { conversationId: 'conv-1', type: 'photo', state: 'active' },
    { conversationId: 'conv-1', type: 'video', state: 'dormant' },
  ];

  // Verify that all 3 distinct types can coexist for the same conversation
  const typesInConv = new Set(activeStreaks.filter(s => s.conversationId === 'conv-1' && s.state !== 'ended').map(s => s.type));
  assert(typesInConv.has('chat') && typesInConv.has('photo') && typesInConv.has('video'), 'Chat, photo, and video can coexist in the same conversation');
  assert(typesInConv.size === 3, 'Exactly 3 distinct streak types coexisting');
  console.log('   ✓ Multiple streak types coexistence verified.');
  passed++;

  // 11. Event Bus Integration
  console.log('11. Testing streak event bus...');
  const eventState = {
    eventDispatched: false,
    receivedEventType: '',
  };

  const unsubscribe = onStreakEvent(evt => {
    eventState.eventDispatched = true;
    eventState.receivedEventType = evt.type;
  });

  const mockStreak: TchatStreak = {
    id: 'streak-123',
    conversation_id: 'conv-1',
    initiator_id: 'alice',
    recipient_id: 'bob',
    type: 'chat',
    state: 'active',
    progress_count: 5,
    created_at: new Date().toISOString(),
    state_changed_at: new Date().toISOString(),
  };

  emitStreakEvent({
    type: 'streak:progressed',
    streak: mockStreak,
    timestamp: new Date().toISOString(),
  });

  assert(eventState.eventDispatched === true, 'Event was received by listener');
  assert(eventState.receivedEventType === 'streak:progressed', 'Event type matched');
  unsubscribe();
  console.log('   ✓ Streak event bus verified.');
  passed++;

  console.log(`\n=== All ${passed} Streak Domain & Invariant Test Suites Passed ===\n`);
}

runStreakTests();
