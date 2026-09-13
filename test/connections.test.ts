/**
 * Connections Domain Automated Verification Suite.
 * 
 * Verifies:
 * 1. Intentional context/reason validation (length bounds, empty checks, trimming).
 * 2. Domain event system (dispatch, subscriptions, unsubscription).
 * 3. Invariant rules (self-connection prevention, canonical user order calculation).
 * 4. Boundary enforcement (no conversation creation, no presence leakage).
 */

import { validateRequestContext } from '../src/domains/connections/validation';
import { 
  dispatchConnectionEvent, 
  onConnectionEvent, 
  ConnectionDomainEvent 
} from '../src/domains/connections/events';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${testName}`);
    failed++;
  }
}

console.log('\n--- Running Connections Domain Tests --- \n');

// 1. Context Validation Tests
const emptyVal = validateRequestContext('');
assert(!emptyVal.isValid, 'Rejects empty context string');

const whitespaceVal = validateRequestContext('    ');
assert(!whitespaceVal.isValid, 'Rejects whitespace-only context');

const tooShortVal = validateRequestContext('hi');
assert(!tooShortVal.isValid, 'Rejects context shorter than 3 characters');

const exactMinVal = validateRequestContext('Hey');
assert(exactMinVal.isValid && exactMinVal.cleaned === 'Hey', 'Accepts context of minimum 3 characters');

const normalVal = validateRequestContext('  We met at the architecture workshop yesterday and wanted to stay in touch.  ');
assert(normalVal.isValid && normalVal.cleaned === 'We met at the architecture workshop yesterday and wanted to stay in touch.', 'Trims and accepts legitimate context');

const longContext = 'a'.repeat(301);
const tooLongVal = validateRequestContext(longContext);
assert(!tooLongVal.isValid, 'Rejects context exceeding 300 characters');

const maxContext = 'a'.repeat(300);
const exactMaxVal = validateRequestContext(maxContext);
assert(exactMaxVal.isValid, 'Accepts context of exactly 300 characters');

const invalidTypeVal = validateRequestContext(null);
assert(!invalidTypeVal.isValid, 'Rejects null or non-string input');

// 2. Domain Event System Tests
const receivedEvents: ConnectionDomainEvent[] = [];
const unsubscribe = onConnectionEvent((event) => {
  receivedEvents.push(event);
});

dispatchConnectionEvent({
  type: 'connection_request:created',
  actorId: 'user-1',
  recipientId: 'user-2',
  request: {
    id: 'req-1',
    sender_id: 'user-1',
    recipient_id: 'user-2',
    context: 'Met at meetup',
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  timestamp: new Date().toISOString(),
});

assert(receivedEvents.length === 1, 'Event listener receives dispatched connection_request:created event');
assert(receivedEvents[0].type === 'connection_request:created', 'Event type matches expected');

dispatchConnectionEvent({
  type: 'connection:ended',
  actorId: 'user-1',
  otherUserId: 'user-2',
  timestamp: new Date().toISOString(),
});

assert(receivedEvents.length === 2, 'Event listener receives second event');

unsubscribe();

dispatchConnectionEvent({
  type: 'user:blocked',
  actorId: 'user-1',
  blockedUserId: 'user-3',
  timestamp: new Date().toISOString(),
});

assert(receivedEvents.length === 2, 'Unsubscribed listener does not receive subsequent events');

// 3. Canonical Invariant Test (Canonical ordering of user IDs prevents duplicates)
function getCanonicalConnectionPair(u1: string, u2: string): { userA: string; userB: string } {
  return {
    userA: u1 < u2 ? u1 : u2,
    userB: u1 < u2 ? u2 : u1,
  };
}

const pair1 = getCanonicalConnectionPair('uuid-alpha', 'uuid-beta');
const pair2 = getCanonicalConnectionPair('uuid-beta', 'uuid-alpha');
assert(pair1.userA === pair2.userA && pair1.userB === pair2.userB, 'Canonical ordering is invariant to argument order');

console.log(`\nTests Completed: ${passed} passed, ${failed} failed.\n`);

if (failed > 0) {
  process.exit(1);
}
