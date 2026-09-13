/**
 * Username & Profile Validation Rules for Tchat.
 * 
 * Rules:
 * - Username length: 3 to 24 characters.
 * - Allowed characters: [a-zA-Z0-9_] (letters, numbers, underscores).
 * - Normalized username: lower(trim(username)).
 * - Display name: optional, max 50 characters.
 * - Bio: optional, max 200 characters.
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  normalized?: string;
}

export function normalizeUsername(username: string): string {
  const trimmed = username.trim().toLowerCase();
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

export function validateUsername(rawUsername: string): ValidationResult {
  let trimmed = rawUsername.trim();
  if (trimmed.startsWith('@')) {
    trimmed = trimmed.slice(1);
  }

  if (!trimmed) {
    return { isValid: false, error: 'Username is required.' };
  }

  if (trimmed.length < 3) {
    return { isValid: false, error: 'Username must be at least 3 characters long.' };
  }

  if (trimmed.length > 24) {
    return { isValid: false, error: 'Username cannot exceed 24 characters.' };
  }

  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  if (!usernameRegex.test(trimmed)) {
    return { 
      isValid: false, 
      error: 'Username can only contain letters, numbers, and underscores.' 
    };
  }

  return {
    isValid: true,
    normalized: normalizeUsername(trimmed),
  };
}

export function validateDisplayName(name?: string | null): ValidationResult {
  if (!name || !name.trim()) return { isValid: true };
  if (name.trim().length > 50) {
    return { isValid: false, error: 'Display name cannot exceed 50 characters.' };
  }
  return { isValid: true };
}

export function validateBio(bio?: string | null): ValidationResult {
  if (!bio || !bio.trim()) return { isValid: true };
  if (bio.trim().length > 200) {
    return { isValid: false, error: 'Bio cannot exceed 200 characters.' };
  }
  return { isValid: true };
}
