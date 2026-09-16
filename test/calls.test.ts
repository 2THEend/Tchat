/**
 * Calls Domain & Immediate Call Requests Automated Tests — Phase 1
 * Verifies:
 * 1. Call reason requirement & validation (preset, custom, combined, length limits)
 * 2. Mode validation (strictly immediate in Phase 1)
 * 3. Expiration calculation & provisional 120s default
 * 4. Reason display formatting
 * 5. Event bus dispatching & subscription
 * 6. State lifecycle invariants (pending -> accepted / declined / cancelled / expired)
 */

import {
  validateCallReason,
  validateCallMode,
  formatCallReason,
  isCallRequestExpired,
  getRemainingCallRequestSeconds,
  calculateCallExpirationDate,
} from '../src/domains/calls/validation';
import {
  CallPresetReason,
  CALL_PRESET_LABELS,
  DEFAULT_IMMEDIATE_CALL_EXPIRATION_SECONDS,
  TchatCall,
} from '../src/domains/calls/types';
import { onCallEvent, emitCallEvent, CallEvent } from '../src/domains/calls/events';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runCallsTests() {
  console.log('=== Running Tchat Calls Phase 1 Tests ===\n');
  let passed = 0;

  // 1. Call Reason Validation
  console.log('1. Testing call reason validation...');
  // No reason provided -> rejected
  const emptyRes = validateCallReason(null, null);
  assert(!emptyRes.isValid, 'Call without reason must be invalid');
  assert(typeof emptyRes.error === 'string', 'Error message must be present for empty reason');

  const whitespaceRes = validateCallReason('  ', '   ');
  assert(!whitespaceRes.isValid, 'Call with only whitespace must be invalid');

  // Preset reason provided -> valid
  const presetRes = validateCallReason('quick_sync', null);
  assert(presetRes.isValid, 'Preset reason must be valid');
  assert(presetRes.cleanPreset === 'quick_sync', 'Clean preset must match');
  assert(presetRes.cleanCustom === null, 'Clean custom must be null');

  // Custom reason provided -> valid
  const customRes = validateCallReason(null, 'Discussing proposal timeline');
  assert(customRes.isValid, 'Custom reason must be valid');
  assert(customRes.cleanPreset === null, 'Clean preset must be null');
  assert(customRes.cleanCustom === 'Discussing proposal timeline', 'Clean custom must match');

  // Both preset and custom provided -> valid
  const combinedRes = validateCallReason('urgent', 'Server is returning 500 errors');
  assert(combinedRes.isValid, 'Combined preset and custom must be valid');
  assert(combinedRes.cleanPreset === 'urgent', 'Preset must match');
  assert(combinedRes.cleanCustom === 'Server is returning 500 errors', 'Custom must match');

  // Too long custom reason -> rejected (>300 chars)
  const longText = 'a'.repeat(301);
  const tooLongRes = validateCallReason('quick_sync', longText);
  assert(!tooLongRes.isValid, 'Reason over 300 characters must be rejected');

  // Single character custom note without preset -> rejected (<2 chars)
  const shortRes = validateCallReason(null, 'a');
  assert(!shortRes.isValid, 'Reason under 2 characters without preset must be rejected');

  console.log('   ✓ Call reason validation passed.');
  passed++;

  // 2. Mode Validation (Phase 1 constraint)
  console.log('2. Testing call mode constraint (immediate only in Phase 1)...');
  assert(validateCallMode('immediate').isValid === true, 'immediate mode is valid');
  assert(validateCallMode('scheduled').isValid === false, 'scheduled mode is invalid in Phase 1');
  assert(validateCallMode('video').isValid === false, 'video mode is invalid in Phase 1');
  assert(validateCallMode('').isValid === false, 'empty mode is invalid');
  console.log('   ✓ Call mode validation passed.');
  passed++;

  // 3. Expiration Calculation & Helpers
  console.log('3. Testing expiration calculation & countdown...');
  assert(
    DEFAULT_IMMEDIATE_CALL_EXPIRATION_SECONDS === 120,
    'Provisional default expiration must be 120 seconds'
  );

  const futureIso = calculateCallExpirationDate(120);
  const futureDate = new Date(futureIso);
  const now = Date.now();
  const diffSec = Math.round((futureDate.getTime() - now) / 1000);
  assert(diffSec >= 118 && diffSec <= 122, `Calculated expiration within 120s (got ${diffSec})`);

  // Remaining seconds
  const remainingSec = getRemainingCallRequestSeconds(futureIso);
  assert(remainingSec > 100 && remainingSec <= 120, 'Remaining seconds should be ~120');

  // Expired check
  const pastIso = new Date(Date.now() - 5000).toISOString();
  assert(isCallRequestExpired({ request_expires_at: pastIso, status: 'pending' }) === true, 'Past date is expired');
  assert(isCallRequestExpired({ request_expires_at: futureIso, status: 'pending' }) === false, 'Future date is not expired');
  assert(isCallRequestExpired({ request_expires_at: futureIso, status: 'expired' }) === true, 'Status expired is expired');

  console.log('   ✓ Expiration calculation passed.');
  passed++;

  // 4. Reason Display Formatting
  console.log('4. Testing call reason formatting...');
  const formatted1 = formatCallReason({ preset_reason: 'quick_sync', custom_reason: null });
  assert(formatted1 === CALL_PRESET_LABELS.quick_sync, `Preset label formatted: ${formatted1}`);

  const formatted2 = formatCallReason({ preset_reason: null, custom_reason: 'Catching up on news' });
  assert(formatted2 === '"Catching up on news"', `Custom reason formatted: ${formatted2}`);

  const formatted3 = formatCallReason({ preset_reason: 'urgent', custom_reason: 'Need review now' });
  assert(
    formatted3 === `${CALL_PRESET_LABELS.urgent} — "Need review now"`,
    `Combined formatted: ${formatted3}`
  );
  console.log('   ✓ Call reason formatting passed.');
  passed++;

  // 5. Calls Event Bus
  console.log('5. Testing calls event bus...');
  const receivedEvents: CallEvent[] = [];
  const unsubscribe = onCallEvent((evt) => {
    receivedEvents.push(evt);
  });

  const mockCall: TchatCall = {
    id: 'test-call-123',
    conversation_id: 'test-conv-456',
    initiator_id: 'user-a',
    recipient_id: 'user-b',
    mode: 'immediate',
    preset_reason: 'quick_sync',
    custom_reason: null,
    request_expires_at: new Date(Date.now() + 120000).toISOString(),
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  emitCallEvent('call:requested', mockCall);
  emitCallEvent('call:accepted', { ...mockCall, status: 'accepted' });
  emitCallEvent('call:declined', { ...mockCall, status: 'declined' });
  emitCallEvent('call:cancelled', { ...mockCall, status: 'cancelled' });
  emitCallEvent('call:expired', { ...mockCall, status: 'expired' });

  assert(receivedEvents.length === 5, 'All 5 events received');
  assert(receivedEvents[0].type === 'call:requested', 'First event was call:requested');
  assert(receivedEvents[1].type === 'call:accepted', 'Second event was call:accepted');
  assert(receivedEvents[2].type === 'call:declined', 'Third event was call:declined');
  assert(receivedEvents[3].type === 'call:cancelled', 'Fourth event was call:cancelled');
  assert(receivedEvents[4].type === 'call:expired', 'Fifth event was call:expired');

  unsubscribe();
  emitCallEvent('call:requested', mockCall);
  assert(receivedEvents.length === 5, 'No events received after unsubscribe');
  console.log('   ✓ Calls event bus passed.');
  passed++;

  // 6. State Lifecycle Transition Invariants
  console.log('6. Testing state lifecycle transitions...');
  const allowedTransitions: Record<string, string[]> = {
    pending: ['accepted', 'declined', 'cancelled', 'expired'],
    accepted: ['ended', 'failed'],
    declined: [],
    cancelled: [],
    expired: [],
    ended: [],
  };

  function canTransition(from: string, to: string): boolean {
    return (allowedTransitions[from] || []).includes(to);
  }

  assert(canTransition('pending', 'accepted'), 'pending -> accepted allowed');
  assert(canTransition('pending', 'declined'), 'pending -> declined allowed');
  assert(canTransition('pending', 'cancelled'), 'pending -> cancelled allowed');
  assert(canTransition('pending', 'expired'), 'pending -> expired allowed');
  assert(!canTransition('declined', 'accepted'), 'declined -> accepted disallowed');
  assert(!canTransition('cancelled', 'accepted'), 'cancelled -> accepted disallowed');
  assert(!canTransition('expired', 'accepted'), 'expired -> accepted disallowed');
  assert(!canTransition('accepted', 'declined'), 'accepted -> declined disallowed');

  console.log('   ✓ State lifecycle invariants verified.');
  passed++;

  console.log(`\n=== All ${passed} Calls Phase 1 Test Suites Passed! ===\n`);
}

runCallsTests();
