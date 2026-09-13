/**
 * Authentication and Credential Validation for Tchat.
 * 
 * Rules:
 * - Email: Standard RFC 5322 regex validation, non-empty, trimmed, lowercase.
 * - Password: Minimum 8 characters, maximum 72 characters (bcrypt limit).
 * - Confirmation: Must strictly match new password.
 */

export interface AuthValidationResult {
  isValid: boolean;
  error?: string;
}

export function validateEmail(rawEmail: string): AuthValidationResult {
  const trimmed = rawEmail.trim();

  if (!trimmed) {
    return { isValid: false, error: 'Email address is required.' };
  }

  // Standard practical email validation pattern
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  if (!emailRegex.test(trimmed)) {
    return { isValid: false, error: 'Please enter a valid email address.' };
  }

  return { isValid: true };
}

export function validatePassword(password: string): AuthValidationResult {
  if (!password) {
    return { isValid: false, error: 'Password is required.' };
  }

  if (password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters long.' };
  }

  if (password.length > 72) {
    return { isValid: false, error: 'Password cannot exceed 72 characters.' };
  }

  // Ensure at least one letter and one number or special character for baseline safety
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumberOrSymbol = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);

  if (!hasLetter || !hasNumberOrSymbol) {
    return { 
      isValid: false, 
      error: 'Password must contain at least one letter and one number or symbol.' 
    };
  }

  return { isValid: true };
}

export function validatePasswordConfirmation(password: string, confirmation: string): AuthValidationResult {
  if (!confirmation) {
    return { isValid: false, error: 'Please confirm your password.' };
  }

  if (password !== confirmation) {
    return { isValid: false, error: 'Passwords do not match.' };
  }

  return { isValid: true };
}
