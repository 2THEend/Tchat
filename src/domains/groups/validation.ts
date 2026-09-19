/**
 * Groups Domain Validation & Invariant Enforcers — Stage 4
 */

import { GroupLifetime, GroupVisibility, GroupAccessMode, GroupRole, CreateGroupInput } from './types';

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export function validateGroupName(name: string): ValidationResult {
  if (!name || typeof name !== 'string') {
    return { isValid: false, error: 'Group name is required' };
  }
  const clean = name.trim();
  if (clean.length < 2) {
    return { isValid: false, error: 'Group name must be at least 2 characters long' };
  }
  if (clean.length > 60) {
    return { isValid: false, error: 'Group name cannot exceed 60 characters' };
  }
  return { isValid: true };
}

export function validateGroupReason(reason: string): ValidationResult {
  if (!reason || typeof reason !== 'string') {
    return { isValid: false, error: 'Group reason is required' };
  }
  const clean = reason.trim();
  if (clean.length < 3) {
    return { isValid: false, error: 'Group reason must be at least 3 characters long' };
  }
  if (clean.length > 300) {
    return { isValid: false, error: 'Group reason cannot exceed 300 characters' };
  }
  return { isValid: true };
}

export function validateGroupLifetime(lifetime: string): ValidationResult {
  const allowed: GroupLifetime[] = ['1_day', '3_days', '1_week'];
  if (!allowed.includes(lifetime as GroupLifetime)) {
    return { isValid: false, error: 'Group lifetime must be 1_day, 3_days, or 1_week' };
  }
  return { isValid: true };
}

export function validateGroupSize(maxSize?: number): ValidationResult {
  if (maxSize === undefined || maxSize === null) return { isValid: true };
  if (!Number.isInteger(maxSize) || maxSize < 2 || maxSize > 30) {
    return { isValid: false, error: 'Group max size must be an integer between 2 and 30' };
  }
  return { isValid: true };
}

export function validateCreateGroupInput(input: CreateGroupInput): ValidationResult {
  const nameRes = validateGroupName(input.name);
  if (!nameRes.isValid) return nameRes;

  const reasonRes = validateGroupReason(input.reason);
  if (!reasonRes.isValid) return reasonRes;

  const lifetimeRes = validateGroupLifetime(input.lifetime);
  if (!lifetimeRes.isValid) return lifetimeRes;

  const sizeRes = validateGroupSize(input.maxSize);
  if (!sizeRes.isValid) return sizeRes;

  // Invariant: Private groups cannot have open access
  if (input.visibility === 'private' && input.access_mode === 'open') {
    return { isValid: false, error: 'Private groups cannot have open access mode' };
  }

  // Invariant: Question mode requires a joining question (3-300 chars)
  if (input.access_mode === 'question') {
    if (!input.joiningQuestion || input.joiningQuestion.trim().length < 3) {
      return { isValid: false, error: 'Question access mode requires a joining question (at least 3 characters)' };
    }
    if (input.joiningQuestion.trim().length > 300) {
      return { isValid: false, error: 'Joining question cannot exceed 300 characters' };
    }
  } else if (input.joiningQuestion && input.joiningQuestion.trim().length > 0) {
    return { isValid: false, error: 'Only question access mode can have a joining question' };
  }

  return { isValid: true };
}

export function validateJoinQuestionAnswer(answer?: string | null): ValidationResult {
  if (!answer || typeof answer !== 'string') {
    return { isValid: false, error: 'Answer is required for question-mode groups' };
  }
  const clean = answer.trim();
  if (clean.length < 2) {
    return { isValid: false, error: 'Answer must be at least 2 characters long' };
  }
  if (clean.length > 500) {
    return { isValid: false, error: 'Answer cannot exceed 500 characters' };
  }
  return { isValid: true };
}

export function validateAssignRole(newRole: string): ValidationResult {
  const allowed: GroupRole[] = ['mod', 'special', 'member'];
  if (!allowed.includes(newRole as GroupRole)) {
    return { isValid: false, error: 'Allowed assigned roles are mod, special, or member' };
  }
  return { isValid: true };
}
