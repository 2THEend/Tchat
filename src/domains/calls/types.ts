/**
 * Calls Domain Types & Invariants — Phase 1: Core Schema + Immediate Call Requests
 * Intentional, permission-based social call agreement.
 */

export type CallMode = 'immediate' | 'scheduled';

export type CallStatus =
  | 'pending'
  | 'accepted'
  | 'scheduled'
  | 'connecting'
  | 'connected'
  | 'ended'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'missed'
  | 'failed';

export type CallOutcome =
  | 'success'
  | 'failed'
  | 'network_error'
  | 'abandoned'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'unfriended'
  | 'blocked';

export type CallPresetReason =
  | 'quick_sync'
  | 'catch_up'
  | 'question'
  | 'urgent'
  | 'planning'
  | 'custom';

export const CALL_PRESET_LABELS: Record<CallPresetReason, string> = {
  quick_sync: 'Quick sync (2–5 mins)',
  catch_up: 'Catch up',
  question: 'Quick question',
  urgent: 'Time-sensitive',
  planning: 'Planning / Coordination',
  custom: 'Custom reason',
};

/**
 * Provisional expiration duration for immediate call requests.
 * Mark clearly as provisional/TBD according to Phase 1 directives.
 * Default: 120 seconds (2 minutes).
 */
export const DEFAULT_IMMEDIATE_CALL_EXPIRATION_SECONDS = 120; // Provisional/TBD

export interface TchatCall {
  id: string;
  conversation_id: string;
  initiator_id: string;
  recipient_id: string;
  mode: CallMode;
  preset_reason?: string | null;
  custom_reason?: string | null;
  request_expires_at?: string | null;
  scheduled_at?: string | null;
  status: CallStatus;
  outcome?: CallOutcome | string | null;
  started_at?: string | null;
  ended_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type CallSessionStatus = 'connecting' | 'connected' | 'ended' | 'failed';

export interface TchatCallSession {
  id: string;
  call_id: string;
  status: CallSessionStatus;
  started_at: string;
  connected_at?: string | null;
  ended_at?: string | null;
  outcome?: 'success' | 'failed' | 'network_error' | 'abandoned' | null;
  created_at: string;
}

export interface StartCallSessionResult {
  session_id: string;
  call_id: string;
  status: CallSessionStatus;
  started_at: string;
}

export interface ConfirmCallConnectionResult {
  success: boolean;
  call_id: string;
  session_id: string;
  status: string;
  started_at: string;
}

export interface RecordCallFailureResult {
  success: boolean;
  call_id: string;
  session_id: string;
  session_status: string;
  session_outcome: string;
  call_status: CallStatus;
}

export interface EndCallResult {
  success: boolean;
  call_id: string;
  status: string;
  outcome: string;
  ended_at: string;
}

export interface CreateCallRequestInput {
  conversationId: string;
  presetReason?: string | null;
  customReason?: string | null;
  /**
   * @deprecated Immediate call expiration is strictly server-controlled (120s in Phase 1).
   * Callers cannot choose an arbitrary duration.
   */
  expiresInSeconds?: number;
  mode?: 'immediate'; // Phase 1 strictly immediate
}

export interface RespondToCallInput {
  callId: string;
  response: 'accept' | 'decline';
}

export interface CallServiceResult<T> {
  data: T | null;
  error?: string | null;
  isSchemaPending?: boolean;
}
