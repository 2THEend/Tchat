/**
 * Calls Domain Service Layer — Phase 1: Core Schema + Immediate Call Requests
 * Interfaces directly with Supabase client and PostgreSQL RPCs.
 */

import { supabase } from '../../lib/supabase';
import { 
  TchatCall, 
  CallServiceResult, 
  CreateCallRequestInput, 
  DEFAULT_IMMEDIATE_CALL_EXPIRATION_SECONDS 
} from './types';
import { validateCallReason, validateCallMode } from './validation';
import { emitCallEvent } from './events';

function isPendingSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = err.message || '';
  const code = err.code || '';
  return (
    code === '42P01' || // undefined_table
    code === 'PGRST202' || // function not found
    code === 'PGRST204' || // table not found
    msg.includes('schema cache') ||
    msg.includes('calls') ||
    msg.includes('call_sessions') ||
    msg.includes('function create_call_request') ||
    msg.includes('function respond_to_call') ||
    msg.includes('function cancel_call')
  );
}

/**
 * Creates an immediate call request for a 1:1 conversation.
 */
export async function createCallRequest(
  input: CreateCallRequestInput
): Promise<CallServiceResult<TchatCall>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  // 1. Client-side mode check (Phase 1 strictly immediate)
  const modeValidation = validateCallMode(input.mode || 'immediate');
  if (!modeValidation.isValid) {
    return { data: null, error: modeValidation.error };
  }

  // 2. Client-side reason check
  const reasonValidation = validateCallReason(input.presetReason, input.customReason);
  if (!reasonValidation.isValid) {
    return { data: null, error: reasonValidation.error };
  }

  try {
    const { data, error } = await supabase.rpc('create_call_request', {
      p_conversation_id: input.conversationId,
      p_preset_reason: reasonValidation.cleanPreset,
      p_custom_reason: reasonValidation.cleanCustom,
      p_mode: 'immediate',
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { data: null, error: 'Calls service is initializing.', isSchemaPending: true };
      }
      const msg = error.message || '';
      const code = (error as any).code || '';
      if (
        code === '23505' ||
        msg.includes('idx_unique_pending_call_per_conv') ||
        msg.includes('unique_violation') ||
        msg.includes('duplicate key') ||
        msg.includes('already pending')
      ) {
        return { data: null, error: 'A call request is already pending in this conversation.' };
      }
      return { data: null, error: error.message };
    }

    const createdCall = data as TchatCall;
    emitCallEvent('call:requested', createdCall);
    return { data: createdCall };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to request call.';
    return { data: null, error: message };
  }
}

/**
 * Responds to a pending call request (Accept or Decline).
 */
export async function respondToCall(
  callId: string,
  response: 'accept' | 'decline'
): Promise<CallServiceResult<TchatCall>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('respond_to_call', {
      p_call_id: callId,
      p_response: response,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { data: null, error: 'Calls service is initializing.', isSchemaPending: true };
      }
      return { data: null, error: error.message };
    }

    const updatedCall = data as TchatCall;
    if (response === 'accept') {
      emitCallEvent('call:accepted', updatedCall);
    } else {
      emitCallEvent('call:declined', updatedCall);
    }

    return { data: updatedCall };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to respond to call.';
    return { data: null, error: message };
  }
}

/**
 * Cancels a pending call request by the initiator.
 */
export async function cancelCall(
  callId: string
): Promise<CallServiceResult<TchatCall>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('cancel_call', {
      p_call_id: callId,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { data: null, error: 'Calls service is initializing.', isSchemaPending: true };
      }
      return { data: null, error: error.message };
    }

    const cancelledCall = data as TchatCall;
    emitCallEvent('call:cancelled', cancelledCall);
    return { data: cancelledCall };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to cancel call.';
    return { data: null, error: message };
  }
}

/**
 * Retrieves the currently active or pending call for a conversation, if any.
 */
export async function getActiveCallForConversation(
  conversationId: string
): Promise<CallServiceResult<TchatCall | null>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_active_call_for_conversation', {
      p_conversation_id: conversationId,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { data: null, error: null, isSchemaPending: true };
      }
      return { data: null, error: error.message };
    }

    return { data: (data as TchatCall) || null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch active call.';
    return { data: null, error: message };
  }
}

/**
 * Retrieves past calls for a 1:1 conversation.
 */
export async function getConversationCalls(
  conversationId: string,
  limit = 20
): Promise<CallServiceResult<TchatCall[]>> {
  if (!supabase) {
    return { data: [], error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_conversation_calls', {
      p_conversation_id: conversationId,
      p_limit: limit,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { data: [], error: null, isSchemaPending: true };
      }
      return { data: [], error: error.message };
    }

    return { data: (data as TchatCall[]) || [] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch conversation calls.';
    return { data: [], error: message };
  }
}
