/**
 * Tchat Calls Domain — WebRTC Signaling Protocol Contract (Phase 2)
 * 
 * Ephemeral signaling messages exchanged over authorized Supabase Realtime Broadcast.
 * 
 * Invariants:
 * 1. Signaling data must NEVER be persisted in PostgreSQL application message tables.
 * 2. Signaling topic format is strictly: `calls:signaling:<call_id>`.
 * 3. Topic authorization is enforced at the database level by RLS on `realtime.messages`
 *    via `public.authorize_call_signaling_topic()`. A non-participant cannot join or broadcast.
 * 4. Only minimal required message types are supported: 'offer', 'answer', 'ice_candidate', 'bye'.
 * 5. Every message carries `call_id`, `session_id`, `sender_id`, and `timestamp` to ensure
 *    strict correlation with the durable call and technical session.
 */

export type SignalingMessageType = 'offer' | 'answer' | 'ice_candidate' | 'bye';

export interface BaseSignalingPayload {
  call_id: string;
  session_id: string;
  sender_id: string;
  timestamp: string;
}

export interface OfferSignalingPayload extends BaseSignalingPayload {
  type: 'offer';
  sdp: RTCSessionDescriptionInit;
}

export interface AnswerSignalingPayload extends BaseSignalingPayload {
  type: 'answer';
  sdp: RTCSessionDescriptionInit;
}

export interface IceCandidateSignalingPayload extends BaseSignalingPayload {
  type: 'ice_candidate';
  candidate: RTCIceCandidateInit;
}

export interface ByeSignalingPayload extends BaseSignalingPayload {
  type: 'bye';
  reason?: string;
}

export type SignalingPayload =
  | OfferSignalingPayload
  | AnswerSignalingPayload
  | IceCandidateSignalingPayload
  | ByeSignalingPayload;

/**
 * Derives the canonical Realtime Broadcast topic for a call.
 */
export function getCallSignalingTopic(callId: string): string {
  return `calls:signaling:${callId}`;
}

/**
 * Validates the basic structural integrity of an incoming signaling payload.
 */
export function isValidSignalingPayload(data: unknown): data is SignalingPayload {
  if (!data || typeof data !== 'object') return false;
  const p = data as Record<string, unknown>;

  if (
    typeof p.call_id !== 'string' ||
    typeof p.session_id !== 'string' ||
    typeof p.sender_id !== 'string' ||
    typeof p.timestamp !== 'string' ||
    typeof p.type !== 'string'
  ) {
    return false;
  }

  if (p.type === 'offer' || p.type === 'answer') {
    return !!p.sdp && typeof p.sdp === 'object';
  }

  if (p.type === 'ice_candidate') {
    return !!p.candidate && typeof p.candidate === 'object';
  }

  if (p.type === 'bye') {
    return true;
  }

  return false;
}
