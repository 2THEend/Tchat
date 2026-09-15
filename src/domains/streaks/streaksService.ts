/**
 * Streaks Domain Service Layer
 * Interfaces directly with Supabase client and PostgreSQL RPCs.
 */

import { supabase } from '../../lib/supabase';
import { 
  TchatStreak, 
  TchatStreakProgressDay, 
  StreakType, 
  StreakServiceResult 
} from './types';
import { getUserTimezone, isValidStreakType } from './validation';
import { emitStreakEvent } from './events';

function isPendingSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = err.message || '';
  const code = err.code || '';
  return (
    code === '42P01' || // undefined_table
    code === 'PGRST202' || // function not found
    code === 'PGRST204' || // table not found
    msg.includes('schema cache') ||
    msg.includes('streaks') ||
    msg.includes('streak_participant_days') ||
    msg.includes('streak_progress_days') ||
    msg.includes('function get_conversation_streaks') ||
    msg.includes('function initiate_streak') ||
    msg.includes('function accept_streak') ||
    msg.includes('function end_streak')
  );
}

/**
 * Retrieves all streaks for a 1:1 conversation.
 */
export async function getConversationStreaks(
  conversationId: string
): Promise<StreakServiceResult<TchatStreak[]>> {
  if (!supabase) {
    return { data: [], error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_conversation_streaks', {
      p_conversation_id: conversationId,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { data: [], isSchemaPending: true, error: error.message };
      }
      return { data: [], error: error.message };
    }

    const streaks: TchatStreak[] = (data || []).map((row: any) => ({
      id: row.id,
      conversation_id: row.conversation_id,
      initiator_id: row.initiator_id,
      recipient_id: row.recipient_id,
      type: row.type as StreakType,
      state: row.state,
      progress_count: Number(row.progress_count || 0),
      created_at: row.created_at,
      accepted_at: row.accepted_at,
      accepted_by: row.accepted_by,
      last_progress_at: row.last_progress_at,
      dormant_since: row.dormant_since,
      ended_at: row.ended_at,
      ended_by: row.ended_by,
      end_reason: row.end_reason,
      state_changed_at: row.state_changed_at,
      is_dormant: Boolean(row.is_dormant),
      has_qualifying_today: Boolean(row.has_qualifying_today),
    }));

    return { data: streaks };
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { data: [], isSchemaPending: true, error: err?.message };
    }
    return { data: [], error: err?.message || 'Failed to fetch conversation streaks.' };
  }
}

/**
 * Initiates a new Streak of a specific type (chat, photo, video) in a conversation.
 */
export async function initiateStreak(
  conversationId: string,
  type: StreakType,
  clientTimezone?: string
): Promise<StreakServiceResult<TchatStreak>> {
  if (!supabase) {
    return { error: 'Supabase client is not initialized.' };
  }

  if (!isValidStreakType(type)) {
    return { error: `Invalid streak type: ${type}. Allowed: chat, photo, video.` };
  }

  const timezone = clientTimezone || getUserTimezone();

  try {
    const { data, error } = await supabase.rpc('initiate_streak', {
      p_conversation_id: conversationId,
      p_type: type,
      p_client_timezone: timezone,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { isSchemaPending: true, error: error.message };
      }
      return { error: error.message };
    }

    const streak: TchatStreak = {
      id: data.id,
      conversation_id: data.conversation_id,
      initiator_id: data.initiator_id,
      recipient_id: data.recipient_id,
      type: data.type,
      state: data.state,
      progress_count: Number(data.progress_count || 0),
      created_at: data.created_at,
      state_changed_at: data.state_changed_at,
      is_dormant: false,
      has_qualifying_today: false,
    };

    emitStreakEvent({
      type: 'streak:initiated',
      streak,
      timestamp: new Date().toISOString(),
    });

    return { data: streak };
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { isSchemaPending: true, error: err?.message };
    }
    return { error: err?.message || 'Failed to initiate streak.' };
  }
}

/**
 * Accepts a pending streak as the recipient.
 */
export async function acceptStreak(
  streakId: string,
  clientTimezone?: string
): Promise<StreakServiceResult<TchatStreak>> {
  if (!supabase) {
    return { error: 'Supabase client is not initialized.' };
  }

  const timezone = clientTimezone || getUserTimezone();

  try {
    const { data, error } = await supabase.rpc('accept_streak', {
      p_streak_id: streakId,
      p_client_timezone: timezone,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { isSchemaPending: true, error: error.message };
      }
      return { error: error.message };
    }

    const streak: TchatStreak = {
      id: data.id,
      conversation_id: data.conversation_id,
      initiator_id: data.initiator_id,
      recipient_id: data.recipient_id,
      type: data.type,
      state: data.state,
      progress_count: Number(data.progress_count || 0),
      created_at: data.created_at || new Date().toISOString(),
      accepted_at: data.accepted_at,
      accepted_by: data.accepted_by,
      state_changed_at: data.state_changed_at,
      is_dormant: false,
      has_qualifying_today: false,
    };

    emitStreakEvent({
      type: 'streak:accepted',
      streak,
      timestamp: new Date().toISOString(),
    });

    return { data: streak };
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { isSchemaPending: true, error: err?.message };
    }
    return { error: err?.message || 'Failed to accept streak.' };
  }
}

/**
 * Declines a pending streak as the recipient.
 */
export async function declineStreak(
  streakId: string
): Promise<StreakServiceResult<void>> {
  if (!supabase) {
    return { error: 'Supabase client is not initialized.' };
  }

  try {
    const { error } = await supabase.rpc('decline_streak', {
      p_streak_id: streakId,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { isSchemaPending: true, error: error.message };
      }
      return { error: error.message };
    }

    return {};
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { isSchemaPending: true, error: err?.message };
    }
    return { error: err?.message || 'Failed to decline streak.' };
  }
}

/**
 * Cancels a pending streak as the initiator.
 */
export async function cancelStreak(
  streakId: string
): Promise<StreakServiceResult<void>> {
  if (!supabase) {
    return { error: 'Supabase client is not initialized.' };
  }

  try {
    const { error } = await supabase.rpc('cancel_streak', {
      p_streak_id: streakId,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { isSchemaPending: true, error: error.message };
      }
      return { error: error.message };
    }

    return {};
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { isSchemaPending: true, error: err?.message };
    }
    return { error: err?.message || 'Failed to cancel streak.' };
  }
}

/**
 * Ends an active or dormant streak intentionally.
 */
export async function endStreak(
  streakId: string
): Promise<StreakServiceResult<void>> {
  if (!supabase) {
    return { error: 'Supabase client is not initialized.' };
  }

  try {
    const { error } = await supabase.rpc('end_streak', {
      p_streak_id: streakId,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { isSchemaPending: true, error: error.message };
      }
      return { error: error.message };
    }

    return {};
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { isSchemaPending: true, error: err?.message };
    }
    return { error: err?.message || 'Failed to end streak.' };
  }
}

/**
 * Retrieves the historical progress days for a streak.
 */
export async function getStreakProgressHistory(
  streakId: string,
  limit: number = 30
): Promise<StreakServiceResult<TchatStreakProgressDay[]>> {
  if (!supabase) {
    return { data: [], error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_streak_progress_history', {
      p_streak_id: streakId,
      p_limit: limit,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { data: [], isSchemaPending: true, error: error.message };
      }
      return { data: [], error: error.message };
    }

    const progressDays: TchatStreakProgressDay[] = (data || []).map((row: any) => ({
      id: row.id,
      streak_id: row.streak_id,
      participant_day_a_id: row.participant_day_a_id || '',
      participant_day_b_id: row.participant_day_b_id || '',
      user_a_id: row.user_a_id,
      user_b_id: row.user_b_id,
      user_a_local_date: row.user_a_local_date,
      user_b_local_date: row.user_b_local_date,
      qualified_at: row.qualified_at,
      created_at: row.created_at,
    }));

    return { data: progressDays };
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { data: [], isSchemaPending: true, error: err?.message };
    }
    return { data: [], error: err?.message || 'Failed to fetch streak progress history.' };
  }
}
