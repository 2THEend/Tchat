/**
 * Ephemeral Media Domain Validation & Logic Unit Tests
 */

import {
  validateMediaFile,
  sanitizeFilename,
  calculateMediaExpiration,
  isMediaExpired,
  canRecipientSave,
  formatMediaTimeRemaining,
  formatFileSize,
  MAX_MEDIA_SIZE_BYTES,
  CATEGORY_SIZE_LIMITS,
} from '../src/domains/media/validation';
import { TchatMediaAsset } from '../src/domains/media/types';

function runMediaTests() {
  console.log('=== Running Ephemeral Media Domain Tests ===\n');
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

  // 1. Filename Sanitization Tests
  console.log('--- Filename Sanitization ---');
  assert(sanitizeFilename('normal.jpg') === 'normal.jpg', 'Preserves standard filename');
  assert(sanitizeFilename('../../../etc/passwd.png') === 'passwd.png', 'Strips directory traversal slashes');
  assert(sanitizeFilename('test\x00\x1fphoto.webp') === 'testphoto.webp', 'Strips non-printable control characters');
  assert(sanitizeFilename('my cool photo (1).jpeg') === 'my_cool_photo__1_.jpeg', 'Replaces troublesome punctuation');
  assert(sanitizeFilename('....') === 'attachment', 'Defaults empty/dot string to "attachment"');

  // 2. File Validation Tests
  console.log('\n--- File Validation ---');
  // Empty file
  const emptyRes = validateMediaFile({ name: 'test.jpg', size: 0, type: 'image/jpeg' });
  assert(!emptyRes.isValid && emptyRes.error?.includes('0 bytes'), 'Rejects empty 0-byte file');

  // Exceeds max 50MB limit
  const hugeRes = validateMediaFile({ 
    name: 'giant.mp4', 
    size: MAX_MEDIA_SIZE_BYTES + 1024, 
    type: 'video/mp4' 
  });
  assert(!hugeRes.isValid && hugeRes.error?.includes('exceeds the maximum 50MB'), 'Rejects file > 50MB');

  // Disallowed MIME type
  const exeRes = validateMediaFile({ 
    name: 'malicious.exe', 
    size: 1024, 
    type: 'application/x-msdownload' 
  });
  assert(!exeRes.isValid && exeRes.error?.includes('Unsupported file format'), 'Rejects unsupported executable MIME');

  // Image size limit (20MB)
  const bigImageRes = validateMediaFile({ 
    name: 'photo.jpg', 
    size: CATEGORY_SIZE_LIMITS.image + 1024, 
    type: 'image/jpeg' 
  });
  assert(!bigImageRes.isValid && bigImageRes.error?.includes('exceeds the 20MB limit'), 'Rejects image > 20MB');

  // Valid image
  const validImgRes = validateMediaFile({ 
    name: 'vacation.jpg', 
    size: 2 * 1024 * 1024, 
    type: 'image/jpeg' 
  });
  assert(validImgRes.isValid && validImgRes.mediaType === 'image', 'Accepts valid 2MB JPEG image');

  // Valid video
  const validVidRes = validateMediaFile({ 
    name: 'clip.mp4', 
    size: 30 * 1024 * 1024, 
    type: 'video/mp4' 
  });
  assert(validVidRes.isValid && validVidRes.mediaType === 'video', 'Accepts valid 30MB MP4 video');

  // Valid audio
  const validAudioRes = validateMediaFile({ 
    name: 'voice.m4a', 
    size: 5 * 1024 * 1024, 
    type: 'audio/x-m4a' 
  });
  assert(validAudioRes.isValid && validAudioRes.mediaType === 'audio', 'Accepts valid voice audio file');

  // Valid document
  const validPdfRes = validateMediaFile({ 
    name: 'doc.pdf', 
    size: 10 * 1024 * 1024, 
    type: 'application/pdf' 
  });
  assert(validPdfRes.isValid && validPdfRes.mediaType === 'file', 'Accepts valid PDF document');

  // 3. Expiration Calculation & Detection
  console.log('\n--- Authoritative 24-Hour Expiration ---');
  const now = new Date('2026-09-14T12:00:00.000Z');
  const expiresAt = calculateMediaExpiration(now);
  const diffMs = new Date(expiresAt).getTime() - now.getTime();
  assert(diffMs === 24 * 60 * 60 * 1000, 'calculateMediaExpiration produces exactly +24 hours');

  // Expired detection within 24h
  const activeNowMs = new Date('2026-09-14T18:00:00.000Z').getTime(); // +6 hours
  assert(!isMediaExpired(expiresAt, false, activeNowMs), 'Media is NOT expired 6 hours in');

  // Expired detection after 24h
  const expiredNowMs = new Date('2026-09-15T12:00:01.000Z').getTime(); // +24 hours 1 sec
  assert(isMediaExpired(expiresAt, false, expiredNowMs), 'Media IS expired after 24 hours');

  // CRITICAL RULE: Saved media never expires
  assert(!isMediaExpired(expiresAt, true, expiredNowMs), 'Saved media NEVER expires even when past 24 hours');

  // 4. Sender-Controlled Save Permissions
  console.log('\n--- Recipient Save Permissions ---');
  const baseAsset: Pick<TchatMediaAsset, 'uploader_id' | 'allow_recipient_save' | 'is_saved' | 'expires_at'> = {
    uploader_id: 'user_alice',
    allow_recipient_save: true,
    is_saved: false,
    expires_at: expiresAt,
  };

  // Recipient can save when allowed and active
  assert(canRecipientSave(baseAsset, 'user_bob', activeNowMs), 'Recipient Bob can save Alice active media');

  // Uploader cannot save own media
  assert(!canRecipientSave(baseAsset, 'user_alice', activeNowMs), 'Uploader Alice cannot save own media');

  // Sender disabled saving
  const restrictedAsset = { ...baseAsset, allow_recipient_save: false };
  assert(!canRecipientSave(restrictedAsset, 'user_bob', activeNowMs), 'Recipient Bob CANNOT save when sender disabled saving');

  // Already saved
  const savedAsset = { ...baseAsset, is_saved: true };
  assert(!canRecipientSave(savedAsset, 'user_bob', activeNowMs), 'Recipient Bob CANNOT save media that is already saved');

  // Expired
  assert(!canRecipientSave(baseAsset, 'user_bob', expiredNowMs), 'Recipient Bob CANNOT save expired media');

  // 5. Formatting Helpers
  console.log('\n--- Formatting Helpers ---');
  assert(formatMediaTimeRemaining(expiresAt, true, activeNowMs) === 'Saved', 'Format returns "Saved" when is_saved is true');
  assert(formatMediaTimeRemaining(expiresAt, false, expiredNowMs) === 'Expired', 'Format returns "Expired" when diff <= 0');
  assert(formatMediaTimeRemaining(expiresAt, false, activeNowMs).includes('18h left'), 'Format shows ~18h left at 6 hours in');
  assert(formatFileSize(1024 * 1024 * 2.5) === '2.5 MB', 'Formats 2.5 MB correctly');

  console.log(`\n=== Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runMediaTests();
