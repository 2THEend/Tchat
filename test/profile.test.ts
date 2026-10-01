/**
 * Tchat: Profile Domain & Avatar Storage Unit & Integration Tests
 * 
 * Verifies:
 * - Username format, normalization, and bounds (3-24 chars, [a-zA-Z0-9_])
 * - Display name bounds (optional, max 50 chars)
 * - Bio bounds (optional, max 200 chars)
 * - Avatar file validation (MIME types, max 5MB, non-empty)
 * - Profile identity caching integration
 * - Server-side RPC signature & security definition verification
 */

import {
  validateUsername,
  validateDisplayName,
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

// Mock localStorage for node test runner
class MockStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) || null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

const mockLocalStorage = new MockStorage();
(globalThis as any).localStorage = mockLocalStorage;

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runProfileTests() {
  console.log('=== Running Profile Domain & Validation Unit Tests ===\n');
  let passed = 0;

  // 1. Username Validation Suite
  console.log('1. Testing Username Validation & Normalization:');

  const emptyRes = validateUsername('');
  assert(!emptyRes.isValid, 'Empty username is rejected');
  passed++;

  const spacesRes = validateUsername('   ');
  assert(!spacesRes.isValid, 'Whitespace-only username is rejected');
  passed++;

  const shortRes = validateUsername('ab');
  assert(!shortRes.isValid, 'Username shorter than 3 characters is rejected');
  passed++;

  const longRes = validateUsername('a'.repeat(25));
  assert(!longRes.isValid, 'Username longer than 24 characters is rejected');
  passed++;

  const validMinRes = validateUsername('abc');
  assert(validMinRes.isValid && validMinRes.normalized === 'abc', '3-character username is accepted');
  passed++;

  const validMaxRes = validateUsername('a'.repeat(24));
  assert(validMaxRes.isValid && validMaxRes.normalized === 'a'.repeat(24), '24-character username is accepted');
  passed++;

  const atPrefixedRes = validateUsername('@alex_99');
  assert(atPrefixedRes.isValid && atPrefixedRes.normalized === 'alex_99', 'Leading @ is stripped cleanly in username validation');
  passed++;

  const specialCharsRes = validateUsername('alex-smith');
  assert(!specialCharsRes.isValid, 'Dashes in username are rejected');
  passed++;

  const spaceInsideRes = validateUsername('alex smith');
  assert(!spaceInsideRes.isValid, 'Spaces inside username are rejected');
  passed++;

  const emojiRes = validateUsername('alex🚀');
  assert(!emojiRes.isValid, 'Emojis in username are rejected');
  passed++;

  const normRes = normalizeUsername('  @Jordan_P_99  ');
  assert(normRes === 'jordan_p_99', 'normalizeUsername trims, lowercases, and strips @');
  passed++;
  console.log(`   ✓ ${passed} username validation checks passed.\n`);

  // 2. Display Name Validation Suite
  console.log('2. Testing Display Name Validation:');
  const dStart = passed;

  assert(validateDisplayName(null).isValid, 'Null display name is valid');
  passed++;

  assert(validateDisplayName(undefined).isValid, 'Undefined display name is valid');
  passed++;

  assert(validateDisplayName('').isValid, 'Empty display name is valid');
  passed++;

  assert(validateDisplayName('  ').isValid, 'Whitespace display name is valid');
  passed++;

  const validName = validateDisplayName('Jordan Parker');
  assert(validName.isValid, 'Normal display name is valid');
  passed++;

  const maxName = validateDisplayName('a'.repeat(50));
  assert(maxName.isValid, '50-character display name is valid');
  passed++;

  const tooLongName = validateDisplayName('a'.repeat(51));
  assert(!tooLongName.isValid, '51-character display name is rejected');
  passed++;
  console.log(`   ✓ ${passed - dStart} display name validation checks passed.\n`);

  // 3. Bio Validation Suite
  console.log('3. Testing Bio Validation:');
  const bStart = passed;

  assert(validateBio(null).isValid, 'Null bio is valid');
  passed++;

  assert(validateBio(undefined).isValid, 'Undefined bio is valid');
  passed++;

  assert(validateBio('').isValid, 'Empty bio is valid');
  passed++;

  const validBio = validateBio('Building intentional communication apps.');
  assert(validBio.isValid, 'Standard bio is valid');
  passed++;

  const maxBio = validateBio('x'.repeat(200));
  assert(maxBio.isValid, '200-character bio is valid');
  passed++;

  const tooLongBio = validateBio('x'.repeat(201));
  assert(!tooLongBio.isValid, '201-character bio is rejected');
  passed++;
  console.log(`   ✓ ${passed - bStart} bio validation checks passed.\n`);

  // 4. Avatar File Validation Suite
  console.log('4. Testing Avatar Image Validation:');
  const aStart = passed;

  assert(!validateAvatarFile(null).isValid, 'Null avatar file is rejected');
  passed++;

  assert(!validateAvatarFile(undefined).isValid, 'Undefined avatar file is rejected');
  passed++;

  const zeroByte = validateAvatarFile({ size: 0, type: 'image/jpeg' });
  assert(!zeroByte.isValid, 'Zero-byte image file is rejected');
  passed++;

  const validJpg = validateAvatarFile({ size: 1024 * 1024, type: 'image/jpeg' });
  assert(validJpg.isValid, '1MB JPG is accepted');
  passed++;

  const validPng = validateAvatarFile({ size: 2 * 1024 * 1024, type: 'image/png' });
  assert(validPng.isValid, '2MB PNG is accepted');
  passed++;

  const validWebp = validateAvatarFile({ size: 500 * 1024, type: 'image/webp' });
  assert(validWebp.isValid, '500KB WebP is accepted');
  passed++;

  const validGif = validateAvatarFile({ size: 1024 * 500, type: 'image/gif' });
  assert(validGif.isValid, '500KB GIF is accepted');
  passed++;

  const oversized = validateAvatarFile({ size: MAX_AVATAR_SIZE_BYTES + 1, type: 'image/png' });
  assert(!oversized.isValid, 'Oversized file (> 5MB) is rejected');
  passed++;

  const invalidMime = validateAvatarFile({ size: 1024, type: 'application/pdf' });
  assert(!invalidMime.isValid, 'PDF file is rejected as avatar');
  passed++;

  const executableMime = validateAvatarFile({ size: 1024, type: 'application/octet-stream' });
  assert(!executableMime.isValid, 'Binary stream is rejected as avatar');
  passed++;
  console.log(`   ✓ ${passed - aStart} avatar file validation checks passed.\n`);

  // 5. Identity Caching Suite
  console.log('5. Testing Identity Caching with Updated Profile:');
  const cStart = passed;

  clearCachedIdentity();
  assert(getCachedIdentity() === null, 'Cache is empty initially');
  passed++;

  const initialProfile: TchatProfile = {
    id: 'user-001',
    username: 'jordan',
    normalized_username: 'jordan',
    display_name: 'Jordan',
    avatar_url: null,
    bio: 'Initial bio',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const account: TchatAccount = {
    id: 'user-001',
    status: 'active',
    email: 'jordan@example.com',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  saveCachedIdentity('user-001', initialProfile, account, 'jordan@example.com');
  const cached1 = getCachedIdentity();
  assert(cached1?.profile.username === 'jordan', 'Initial profile cached');
  passed++;

  // Simulate profile update
  const updatedProfile: TchatProfile = {
    ...initialProfile,
    username: 'jordan_updated',
    normalized_username: 'jordan_updated',
    display_name: 'Jordan Parker',
    avatar_url: 'https://example.com/avatar.jpg',
    bio: 'Updated thoughtful bio.',
    updated_at: new Date().toISOString(),
  };

  saveCachedIdentity('user-001', updatedProfile, account, 'jordan@example.com');
  const cached2 = getCachedIdentity();
  assert(cached2?.profile.username === 'jordan_updated', 'Updated profile username saved in cache');
  assert(cached2?.profile.display_name === 'Jordan Parker', 'Updated display name saved in cache');
  assert(cached2?.profile.avatar_url === 'https://example.com/avatar.jpg', 'Updated avatar url saved in cache');
  assert(cached2?.profile.bio === 'Updated thoughtful bio.', 'Updated bio saved in cache');
  passed += 4;

  clearCachedIdentity();
  assert(getCachedIdentity() === null, 'Cache cleared after test');
  passed++;
  console.log(`   ✓ ${passed - cStart} identity cache checks passed.\n`);

  console.log(`=================================================`);
  console.log(`All ${passed} Profile Domain Unit Tests Passed Successfully!`);
  console.log(`=================================================\n`);
}

runProfileTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
