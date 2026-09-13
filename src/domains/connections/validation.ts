/**
 * Connections Domain Validation.
 * 
 * Enforces intentional context/reason for connection requests.
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  cleaned?: string;
}

export function validateRequestContext(context: unknown): ValidationResult {
  if (typeof context !== 'string') {
    return {
      isValid: false,
      error: 'Context reason is required.',
    };
  }

  const trimmed = context.trim();

  if (trimmed.length === 0) {
    return {
      isValid: false,
      error: 'A context note explaining why you want to connect is required.',
    };
  }

  if (trimmed.length < 3) {
    return {
      isValid: false,
      error: 'Context must be at least 3 characters long.',
    };
  }

  if (trimmed.length > 300) {
    return {
      isValid: false,
      error: 'Context cannot exceed 300 characters.',
    };
  }

  return {
    isValid: true,
    cleaned: trimmed,
  };
}
