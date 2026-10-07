/**
 * Calls Domain Validation & Invariant Helpers
 */

import { 
  CallPresetReason, 
  CALL_PRESET_LABELS, 
  DEFAULT_IMMEDIATE_CALL_EXPIRATION_SECONDS, 
  TchatCall,
  TchatIncomingCall
} from './types';

export interface CallReasonValidationResult {
  isValid: boolean;
  cleanPreset: string | null;
  cleanCustom: string | null;
  error?: string;
}

/**
 * Validates that an immediate call request has a meaningful reason.
 * The initiator can provide a preset reason, a custom note, or both.
 * Calls with no reason are strictly rejected.
 */
export function validateCallReason(
  presetReason?: string | null,
  customReason?: string | null
): CallReasonValidationResult {
  const cleanPreset = presetReason && presetReason.trim().length > 0 ? presetReason.trim() : null;
  const cleanCustom = customReason && customReason.trim().length > 0 ? customReason.trim() : null;

  if (!cleanPreset && !cleanCustom) {
    return {
      isValid: false,
      cleanPreset: null,
      cleanCustom: null,
      error: 'A call reason is required. Please select a reason or provide a custom note.',
    };
  }

  if (cleanCustom && cleanCustom.length > 300) {
    return {
      isValid: false,
      cleanPreset,
      cleanCustom,
      error: 'Custom call reason exceeds maximum allowed length of 300 characters.',
    };
  }

  if (cleanCustom && cleanCustom.length < 2 && !cleanPreset) {
    return {
      isValid: false,
      cleanPreset,
      cleanCustom,
      error: 'Custom call reason must be at least 2 characters.',
    };
  }

  return {
    isValid: true,
    cleanPreset,
    cleanCustom,
  };
}

/**
 * Validates call mode for Phase 1.
 * Scheduled calls are strictly deferred to Phase 2.
 */
export function validateCallMode(mode: string): { isValid: boolean; error?: string } {
  if (mode !== 'immediate') {
    return {
      isValid: false,
      error: 'Phase 1 only supports immediate call requests. Scheduled calls are not permitted yet.',
    };
  }
  return { isValid: true };
}

/**
 * Formats a composite reason string for display.
 */
export function formatCallReason(call: Pick<TchatCall, 'preset_reason' | 'custom_reason'>): string {
  const presetKey = call.preset_reason as CallPresetReason | undefined;
  const presetLabel = presetKey && CALL_PRESET_LABELS[presetKey] ? CALL_PRESET_LABELS[presetKey] : call.preset_reason;

  if (presetLabel && call.custom_reason) {
    return `${presetLabel} — "${call.custom_reason}"`;
  }
  if (presetLabel) {
    return presetLabel;
  }
  if (call.custom_reason) {
    return `"${call.custom_reason}"`;
  }
  return 'Call requested';
}

/**
 * Checks whether a call request has expired based on its expiration timestamp.
 */
export function isCallRequestExpired(call: Pick<TchatCall, 'request_expires_at' | 'status'>): boolean {
  if (call.status === 'expired') return true;
  if (!call.request_expires_at) return false;
  return new Date(call.request_expires_at).getTime() <= Date.now();
}

/**
 * Formats remaining seconds until request expiration.
 */
export function getRemainingCallRequestSeconds(requestExpiresAt?: string | null): number {
  if (!requestExpiresAt) return 0;
  const diffMs = new Date(requestExpiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / 1000));
}

/**
 * Calculates provisional expiration timestamp according to server-controlled policy.
 * In Phase 1, the expiration policy is strictly server-controlled at 120 seconds.
 * Client callers cannot choose an arbitrary expiration duration.
 */
export function calculateCallExpirationDate(_requestedSeconds?: number): string {
  // Expiration duration is strictly server-controlled at 120 seconds.
  // Any client-requested duration is ignored.
  return new Date(Date.now() + DEFAULT_IMMEDIATE_CALL_EXPIRATION_SECONDS * 1000).toISOString();
}

/**
 * Checks whether a call record represents an active, non-expired pending incoming call
 * specifically addressed to the given authenticated user.
 */
export function isPendingIncomingCallForUser(
  call: TchatCall | null | undefined,
  currentUserId: string,
  nowMs: number = Date.now()
): boolean {
  if (!call || !currentUserId) return false;
  if (call.recipient_id !== currentUserId) return false;
  if (call.initiator_id === currentUserId) return false;
  if (call.status !== 'pending') return false;
  if (call.request_expires_at) {
    const expiresMs = new Date(call.request_expires_at).getTime();
    if (Number.isNaN(expiresMs) || expiresMs <= nowMs) {
      return false;
    }
  }
  return true;
}

/**
 * Produces a deterministic deduplication key for a call state event so duplicate
 * realtime broadcasts for the same call transition are safely ignored.
 */
export function getCallEventDedupeKey(
  call: Pick<TchatCall, 'id' | 'status'> & { updated_at?: string | null }
): string {
  return `${call.id}:${call.status}:${call.updated_at || ''}`;
}

/**
 * Resolves the authoritative global incoming call state for the authenticated user.
 * - Filters out calls belonging to other users or initiated by the current user.
 * - Immediately clears prompts when a call is accepted, declined, cancelled, expired, or ended.
 * - Preserves existing reference if a duplicate event arrives for the exact same call state.
 */
export function resolveGlobalIncomingCallState(
  currentIncomingCall: TchatIncomingCall | null,
  candidateCall: TchatIncomingCall | null,
  currentUserId: string,
  nowMs: number = Date.now()
): TchatIncomingCall | null {
  if (!isPendingIncomingCallForUser(candidateCall, currentUserId, nowMs) || !candidateCall) {
    return null;
  }

  if (
    currentIncomingCall &&
    currentIncomingCall.id === candidateCall.id &&
    currentIncomingCall.status === candidateCall.status &&
    currentIncomingCall.updated_at === candidateCall.updated_at &&
    Boolean(currentIncomingCall.caller_profile) === Boolean(candidateCall.caller_profile)
  ) {
    return currentIncomingCall;
  }

  return candidateCall;
}

