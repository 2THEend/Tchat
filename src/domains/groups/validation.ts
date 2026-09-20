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

/**
 * Maps database/RPC error strings into concise, human-readable messages.
 * Prevents raw Postgres or Supabase traces from surfacing in the UI.
 */
export function formatGroupError(rawError?: string | null, fallback = 'An unexpected error occurred. Please try again.'): string {
  if (!rawError) return fallback;

  const str = rawError.toLowerCase();

  if (str.includes('reached maximum capacity') || str.includes('group is full') || str.includes('maximum capacity reached')) {
    return 'This group has reached its maximum member capacity.';
  }
  if (str.includes('has expired') || str.includes('no longer active') || str.includes('expired')) {
    return 'This group has expired or is no longer active.';
  }
  if (str.includes('already pending') || str.includes('pending join request')) {
    return 'You already have a pending join request for this group.';
  }
  if (str.includes('banned') || str.includes('not permitted to join')) {
    return 'You are restricted from participating in this group.';
  }
  if (str.includes('removed from group') || str.includes('previously removed')) {
    return 'You were removed from this group and cannot rejoin.';
  }
  if (str.includes('safety blocks') || str.includes('blocked')) {
    return 'Cannot join this group due to user safety or block settings.';
  }
  if (str.includes('without designating an active member as successor') || str.includes('select another active member')) {
    return 'As group administrator, you must select another active member as successor before leaving.';
  }
  if (str.includes('designated successor is not an active member')) {
    return 'The chosen successor is not an active member of this group.';
  }
  if (str.includes('only group admins') || str.includes('only admins or mods') || str.includes('not authorized')) {
    return 'Only group administrators or moderators are permitted to perform this action.';
  }
  if (str.includes('no longer pending')) {
    return 'This join request is no longer pending.';
  }
  if (str.includes('not found') || str.includes('inaccessible')) {
    return 'This group could not be found or is private and inaccessible.';
  }
  if (str.includes('not authenticated')) {
    return 'You must be signed in to perform this action.';
  }
  if (str.includes('answer between 2 and 500 characters')) {
    return 'An answer between 2 and 500 characters is required.';
  }

  // Generic fallback without raw database artifacts
  return rawError.replace(/^[A-Z0-9_]+:\s*/, '').slice(0, 150);
}

