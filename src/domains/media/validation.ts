/**
 * Ephemeral Media Validation & Lifecycle Helpers
 * Implements client and server-aligned validation for media assets.
 */

import { MediaCategory, MediaValidationResult, TchatMediaAsset } from './types';

export const MAX_MEDIA_SIZE_BYTES = 50 * 1024 * 1024; // 50MB max upload

export const CATEGORY_SIZE_LIMITS: Record<MediaCategory, number> = {
  image: 20 * 1024 * 1024, // 20MB
  audio: 25 * 1024 * 1024, // 25MB
  video: 50 * 1024 * 1024, // 50MB
  file: 50 * 1024 * 1024,  // 50MB
};

export const ALLOWED_MIME_TYPES: Record<string, MediaCategory> = {
  // Images
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',

  // Videos
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',

  // Audio
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/mp4': 'audio',
  'audio/webm': 'audio',
  'audio/ogg': 'audio',
  'audio/wav': 'audio',
  'audio/aac': 'audio',
  'audio/x-m4a': 'audio',

  // Files / Documents
  'application/pdf': 'file',
  'text/plain': 'file',
};

/**
 * Sanitizes original filenames by stripping directory traversal,
 * control characters, and limiting length.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'attachment';
  }

  // Strip path traversal sequences and slashes
  let clean = filename.replace(/^.*[/\\]/, '');
  // Remove control chars and non-printable characters
  clean = clean.replace(/[\x00-\x1f\x7f]/g, '');
  // Replace troublesome punctuation while preserving standard dots, dashes, underscores
  clean = clean.replace(/[^\w.-]/g, '_');
  // Trim leading/trailing whitespace or dots
  clean = clean.trim().replace(/^\.+/, '');

  if (clean.length === 0) {
    clean = 'attachment';
  }

  // Limit to 100 characters while preserving extension
  if (clean.length > 100) {
    const extIndex = clean.lastIndexOf('.');
    if (extIndex !== -1 && clean.length - extIndex <= 10) {
      const ext = clean.substring(extIndex);
      clean = clean.substring(0, 100 - ext.length) + ext;
    } else {
      clean = clean.substring(0, 100);
    }
  }

  return clean;
}

/**
 * Validates a media file for MIME type, size limit, and name safety.
 */
export function validateMediaFile(file: File | { name: string; size: number; type: string }): MediaValidationResult {
  if (!file) {
    return { isValid: false, error: 'No file provided.' };
  }

  if (file.size <= 0) {
    return { isValid: false, error: 'File is empty (0 bytes).' };
  }

  if (file.size > MAX_MEDIA_SIZE_BYTES) {
    return { 
      isValid: false, 
      error: `File exceeds the maximum 50MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB).` 
    };
  }

  const mimeType = (file.type || '').toLowerCase();
  const mediaType = ALLOWED_MIME_TYPES[mimeType];

  if (!mediaType) {
    return { 
      isValid: false, 
      error: `Unsupported file format (${mimeType || 'unknown'}). Allowed: Photos, Videos, Audio, PDF, Text.` 
    };
  }

  const categoryLimit = CATEGORY_SIZE_LIMITS[mediaType];
  if (file.size > categoryLimit) {
    const maxMb = categoryLimit / (1024 * 1024);
    return {
      isValid: false,
      error: `${mediaType.toUpperCase()} file exceeds the ${maxMb}MB limit for this category.`,
    };
  }

  const cleanFilename = sanitizeFilename(file.name);

  return {
    isValid: true,
    mediaType,
    cleanFilename,
  };
}

/**
 * Authoritative 24-hour expiration calculation:
 * "expires_at = sent_at + 24 hours"
 */
export function calculateMediaExpiration(sentAt: string | Date = new Date()): string {
  const sentDate = typeof sentAt === 'string' ? new Date(sentAt) : sentAt;
  const expiresDate = new Date(sentDate.getTime() + 24 * 60 * 60 * 1000);
  return expiresDate.toISOString();
}

/**
 * Checks whether an ephemeral media asset is currently expired.
 * A saved asset never expires.
 */
export function isMediaExpired(
  expiresAt: string | null | undefined, 
  isSaved: boolean = false, 
  nowMs: number = Date.now()
): boolean {
  if (isSaved) return false;
  if (!expiresAt) return false;

  const expiryTime = new Date(expiresAt).getTime();
  if (isNaN(expiryTime)) return false;

  return expiryTime <= nowMs;
}

/**
 * Determines whether the recipient can save this media asset.
 * Enforces:
 * 1. Must be the recipient (not the uploader).
 * 2. Sender must not have disabled saving (`allow_recipient_save = true`).
 * 3. Must not already be saved.
 * 4. Must not be expired.
 */
export function canRecipientSave(
  asset: Pick<TchatMediaAsset, 'uploader_id' | 'allow_recipient_save' | 'is_saved' | 'expires_at'>,
  currentUserId: string,
  nowMs: number = Date.now()
): boolean {
  if (asset.uploader_id === currentUserId) return false;
  if (!asset.allow_recipient_save) return false;
  if (asset.is_saved) return false;
  if (isMediaExpired(asset.expires_at, asset.is_saved, nowMs)) return false;
  return true;
}

/**
 * Human-readable format of time remaining before expiration.
 */
export function formatMediaTimeRemaining(
  expiresAt: string, 
  isSaved: boolean, 
  nowMs: number = Date.now()
): string {
  if (isSaved) return 'Saved';

  const expiryTime = new Date(expiresAt).getTime();
  const diffMs = expiryTime - nowMs;

  if (diffMs <= 0) return 'Expired';

  const totalMinutes = Math.floor(diffMs / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours >= 1) {
    return `${hours}h left`;
  }
  if (minutes >= 1) {
    return `${minutes}m left`;
  }
  return '< 1m left';
}

/**
 * Formats file size in readable bytes/KB/MB.
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
