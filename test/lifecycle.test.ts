/**
 * App Lifecycle & Mobile Resilience Unit Tests
 */

import {
  getCachedIdentity,
  saveCachedIdentity,
  clearCachedIdentity,
} from '../src/domains/identity/identityCache';
import {
  getStoredActiveConversationId,
  storeActiveConversationId,
  clearStoredActiveConversationId,
  getConversationIdFromHash,
  storeConversationDraft,
  getConversationDraft,
  clearConversationDraft,
} from '../src/domains/conversations/conversationState';
import { TchatAccount, TchatProfile } from '../src/domains/identity/types';

// Mock browser storage & window for node test environment
class MockStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) || null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

const mockLocalStorage = new MockStorage();
const mockSessionStorage = new MockStorage();

let mockHash = '';
const mockLocation = {
  get hash() { return mockHash; },
  set hash(val: string) { mockHash = val; },
  pathname: '/',
  search: '',
};

const mockHistory = {
  state: null,
  replaceState: (_state: any, _title: string, url: string) => {
    const hashIdx = url.indexOf('#');
    mockHash = hashIdx !== -1 ? url.substring(hashIdx) : '';
  },
};

(globalThis as any).localStorage = mockLocalStorage;
(globalThis as any).sessionStorage = mockSessionStorage;
(globalThis as any).window = {
  localStorage: mockLocalStorage,
  sessionStorage: mockSessionStorage,
  location: mockLocation,
  history: mockHistory,
};

function runLifecycleTests() {
  console.log('=== Running App Lifecycle & Mobile Resilience Tests ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Identity Caching Tests
  console.log('--- Identity Caching & Fast Resume ---');
  mockLocalStorage.clear();

  assert(getCachedIdentity() === null, 'Returns null when no cached identity exists');

  const profile: TchatProfile = {
    id: 'user-xyz',
    username: 'jordan',
    normalized_username: 'jordan',
    display_name: 'Jordan Bell',
    avatar_url: null,
    bio: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const account: TchatAccount = {
    id: 'user-xyz',
    email: 'jordan@example.com',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  saveCachedIdentity('user-xyz', profile, account, 'jordan@example.com');
  const cached = getCachedIdentity();

  assert(cached !== null, 'Identity successfully cached');
  assert(cached?.userId === 'user-xyz', 'Cached user ID matches');
  assert(cached?.profile.username === 'jordan', 'Cached profile username matches');
  assert(cached?.account.status === 'active', 'Cached account status is active');
  assert(cached?.userEmail === 'jordan@example.com', 'Cached user email preserved');

  clearCachedIdentity();
  assert(getCachedIdentity() === null, 'Cached identity cleared on sign-out');

  // Corrupted JSON resilience
  mockLocalStorage.setItem('tchat_cached_identity_v1', '{corrupt json');
  assert(getCachedIdentity() === null, 'Handles corrupted JSON safely without throwing');

  // 2. Active Conversation Resilience
  console.log('\n--- Active Conversation Persistence ---');
  mockSessionStorage.clear();
  mockHash = '';

  assert(getStoredActiveConversationId() === null, 'Returns null when no conversation is active');

  const testConvId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  storeActiveConversationId(testConvId);

  assert(getStoredActiveConversationId() === testConvId, 'Active conversation ID retrieved from sessionStorage');
  assert(mockHash === `#c=${testConvId}`, 'URL hash updated with active conversation id #c=<id>');

  // Hash variations
  mockLocation.hash = '#c=conv-from-hash';
  assert(getConversationIdFromHash() === 'conv-from-hash', 'Parses #c=<id> hash format');

  mockLocation.hash = '#conversation=conv-from-long-hash';
  assert(getConversationIdFromHash() === 'conv-from-long-hash', 'Parses #conversation=<id> hash format');

  // Clearing active conversation
  mockLocation.hash = '#c=conv-active';
  mockSessionStorage.setItem('tchat_active_conv_id', 'conv-active');
  clearStoredActiveConversationId();

  assert(mockSessionStorage.getItem('tchat_active_conv_id') === null, 'SessionStorage active conversation removed on exit');
  assert(mockLocation.hash === '', 'URL conversation hash cleanly removed on exit');

  // 3. Draft Resilience
  console.log('\n--- Text Draft Resilience ---');
  const targetConvId = 'conv-draft-testing';

  assert(getConversationDraft(targetConvId) === '', 'Draft is empty initially');

  const draftText = 'Draft message that survives background suspension';
  storeConversationDraft(targetConvId, draftText);

  assert(getConversationDraft(targetConvId) === draftText, 'Preserves in-progress draft text in sessionStorage');

  // Blank draft removal
  storeConversationDraft(targetConvId, '   ');
  assert(getConversationDraft(targetConvId) === '', 'Removes draft when text is whitespace only');

  // Cleared after successful send
  storeConversationDraft(targetConvId, 'Another draft');
  assert(getConversationDraft(targetConvId) === 'Another draft', 'Draft stored before send');
  clearConversationDraft(targetConvId);
  assert(getConversationDraft(targetConvId) === '', 'Draft cleared cleanly after send');

  console.log(`\nLifecycle tests completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runLifecycleTests();
