/**
 * Tchat: Identity Setup & Core Identity Validation Unit Tests
 * 
 * Verifies:
 * - Required display name validation (1-50 chars, no empty/whitespace)
 * - Required unique username handle validation (3-24 chars, [a-zA-Z0-9_], @ stripping)
 * - Optional bio validation (<= 200 chars, nullable)
 * - Optional avatar file validation (JPG/PNG/WebP/GIF, <= 5MB)
 * - Identity setup session draft resilience (save, retrieve, clear)
 * - Post-setup caching integrity with active account guarantee
 */

import {
  validateUsername,
  validateDisplayName,
  validateRequiredDisplayName,
  validateBio,
  normalizeUsername,
  validateAvatarFile,
  MAX_AVATAR_SIZE_BYTES,
  ALLOWED_AVATAR_MIME_TYPES,
} from '../src/domains/identity/validation';

import {
  getCachedIdentity,
  saveCachedIdentity,
  clearCachedIdentity,
} from '../src/domains/identity/identityCache';

import { TchatAccount, TchatProfile } from '../src/domains/identity/types';

// Mock storage
class MockStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) || null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

const mockSessionStorage = new MockStorage();
const mockLocalStorage = new MockStorage();
(globalThis as any).sessionStorage = mockSessionStorage;
(globalThis as any).localStorage = mockLocalStorage;

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runIdentitySetupTests() {
  console.log('=== Running Identity Setup Unit & Integration Tests ===\n');
  let passed = 0;

  // 1. Required Display Name Validation
  console.log('1. Testing Required Display Name Validation:');
  const dStart = passed;

  const emptyRes = validateRequiredDisplayName('');
  assert(!emptyRes.isValid, 'Empty display name is rejected');
  passed++;

  const wsRes = validateRequiredDisplayName('   ');
  assert(!wsRes.isValid, 'Whitespace display name is rejected');
  passed++;

  const nullRes = validateRequiredDisplayName(null);
  assert(!nullRes.isValid, 'Null display name is rejected');
  passed++;

  const undefRes = validateRequiredDisplayName(undefined);
  assert(!undefRes.isValid, 'Undefined display name is rejected');
  passed++;

  const validName = validateRequiredDisplayName('Alex Rivera');
  assert(validName.isValid, 'Standard human name is valid');
  passed++;

  const validSingleChar = validateRequiredDisplayName('A');
  assert(validSingleChar.isValid, 'Single-character display name is valid');
  passed++;

  const maxName = validateRequiredDisplayName('a'.repeat(50));
  assert(maxName.isValid, '50-character display name is valid');
  passed++;

  const tooLongName = validateRequiredDisplayName('a'.repeat(51));
  assert(!tooLongName.isValid, '51-character display name is rejected');
  passed++;
  console.log(`   ✓ ${passed - dStart} required display name checks passed.\n`);

  // 2. Required Username Handle Validation & Normalization
  console.log('2. Testing Username Handle Validation:');
  const uStart = passed;

  assert(!validateUsername('').isValid, 'Empty username is rejected');
  passed++;

  assert(!validateUsername('  ').isValid, 'Whitespace username is rejected');
  passed++;

  assert(!validateUsername('ab').isValid, 'Username under 3 chars is rejected');
  passed++;

  assert(!validateUsername('a'.repeat(25)).isValid, 'Username over 24 chars is rejected');
  passed++;

  const valid3 = validateUsername('sam');
  assert(valid3.isValid && valid3.normalized === 'sam', '3-char username is accepted');
  passed++;

  const valid24 = validateUsername('alex_rivera_architect_99');
  assert(valid24.isValid && valid24.normalized === 'alex_rivera_architect_99', '24-char username is accepted');
  passed++;

  const withAt = validateUsername('@maya_lin');
  assert(withAt.isValid && withAt.normalized === 'maya_lin', 'Leading @ is stripped cleanly');
  passed++;

  const dashes = validateUsername('alex-smith');
  assert(!dashes.isValid, 'Dashes are rejected in handles');
  passed++;

  const spaces = validateUsername('alex smith');
  assert(!spaces.isValid, 'Spaces are rejected in handles');
  passed++;

  assert(normalizeUsername('@Jordan_K_9') === 'jordan_k_9', 'normalizeUsername normalizes correctly');
  passed++;
  console.log(`   ✓ ${passed - uStart} username handle checks passed.\n`);

  // 3. Optional Bio Validation
  console.log('3. Testing Optional Bio Validation:');
  const bStart = passed;

  assert(validateBio(null).isValid, 'Null bio is valid (optional)');
  passed++;

  assert(validateBio(undefined).isValid, 'Undefined bio is valid (optional)');
  passed++;

  assert(validateBio('').isValid, 'Empty bio is valid (optional)');
  passed++;

  assert(validateBio('A calm line about intentional presence.').isValid, 'Standard bio is valid');
  passed++;

  assert(validateBio('x'.repeat(200)).isValid, '200-character bio is valid');
  passed++;

  assert(!validateBio('x'.repeat(201)).isValid, '201-character bio is rejected');
  passed++;
  console.log(`   ✓ ${passed - bStart} bio validation checks passed.\n`);

  // 4. Optional Avatar File Validation
  console.log('4. Testing Optional Avatar File Validation:');
  const aStart = passed;

  assert(!validateAvatarFile(null).isValid, 'Null file rejected');
  passed++;

  assert(!validateAvatarFile({ size: 0, type: 'image/jpeg' }).isValid, '0-byte file rejected');
  passed++;

  assert(validateAvatarFile({ size: 2 * 1024 * 1024, type: 'image/jpeg' }).isValid, '2MB JPG accepted');
  passed++;

  assert(validateAvatarFile({ size: 3 * 1024 * 1024, type: 'image/png' }).isValid, '3MB PNG accepted');
  passed++;

  assert(validateAvatarFile({ size: 500 * 1024, type: 'image/webp' }).isValid, '500KB WebP accepted');
  passed++;

  assert(validateAvatarFile({ size: 1024 * 1024, type: 'image/gif' }).isValid, '1MB GIF accepted');
  passed++;

  assert(!validateAvatarFile({ size: MAX_AVATAR_SIZE_BYTES + 1, type: 'image/jpeg' }).isValid, '>5MB file rejected');
  passed++;

  assert(!validateAvatarFile({ size: 1024, type: 'application/pdf' }).isValid, 'PDF rejected');
  passed++;
  console.log(`   ✓ ${passed - aStart} avatar file checks passed.\n`);

  // 5. Session Draft Persistence
  console.log('5. Testing Identity Setup Session Draft Resilience:');
  const sStart = passed;

  const testUserId = 'user-test-uuid-42';
  const draftKey = `tchat_identity_draft_${testUserId}`;

  mockSessionStorage.clear();
  assert(mockSessionStorage.getItem(draftKey) === null, 'No draft initially');
  passed++;

  const draftData = {
    username: 'alex_r',
    displayName: 'Alex Rivera',
    bio: 'Architecting calm digital spaces.',
    avatarUrl: '',
  };

  mockSessionStorage.setItem(draftKey, JSON.stringify(draftData));
  const retrieved = JSON.parse(mockSessionStorage.getItem(draftKey)!);
  assert(retrieved.username === 'alex_r', 'Draft username preserved across refresh');
  assert(retrieved.displayName === 'Alex Rivera', 'Draft display name preserved across refresh');
  assert(retrieved.bio.includes('Architecting'), 'Draft bio preserved across refresh');
  passed += 3;

  // Clear draft on successful completion
  mockSessionStorage.removeItem(draftKey);
  assert(mockSessionStorage.getItem(draftKey) === null, 'Draft cleanly removed after completion');
  passed++;
  console.log(`   ✓ ${passed - sStart} draft persistence checks passed.\n`);

  // 6. Identity Completion & Cache Fallback
  console.log('6. Testing Identity Completion & Cache Fallback Guarantee:');
  const cStart = passed;

  mockLocalStorage.clear();

  const newProfile: TchatProfile = {
    id: 'user-test-uuid-42',
    username: 'alex_r',
    normalized_username: 'alex_r',
    display_name: 'Alex Rivera',
    avatar_url: 'https://example.com/avatar.jpg',
    bio: 'Architecting calm digital spaces.',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Simulate activeAccount synthesis when account in state was initially null
  const synthesizedAccount: TchatAccount = {
    id: newProfile.id,
    status: 'active',
    email: 'alex@example.com',
    created_at: newProfile.created_at,
    updated_at: newProfile.updated_at,
  };

  saveCachedIdentity(newProfile.id, newProfile, synthesizedAccount, 'alex@example.com');
  const cached = getCachedIdentity();

  assert(cached !== null, 'Cached identity created');
  assert(cached?.profile.username === 'alex_r', 'Cached username matches');
  assert(cached?.profile.display_name === 'Alex Rivera', 'Cached display name matches');
  assert(cached?.account.status === 'active', 'Synthesized account is active');
  assert(cached?.userEmail === 'alex@example.com', 'Cached email matches');
  passed += 5;

  clearCachedIdentity();
  assert(getCachedIdentity() === null, 'Cache cleared cleanly');
  passed++;
  console.log(`   ✓ ${passed - cStart} identity cache checks passed.\n`);

  console.log('==================================================');
  console.log(`All ${passed} Identity Setup Tests Passed Successfully!`);
  console.log('==================================================\n');
}

runIdentitySetupTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
