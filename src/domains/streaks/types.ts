/**
 * Streaks Domain Types & Invariants
 * Intentional, participation-based Streaks representing mutual continuity.
 */

export type StreakType = 'chat' | 'photo' | 'video';

export type StreakState = 'pending' | 'active' | 'dormant' | 'ended';

export type StreakEndReason = 
  | 'declined' 
  | 'cancelled' 
  | 'unfriended' 
  | 'blocked' 
  | 'manual_ended' 
  | 'system';

export interface TchatStreak {
  id: string;
  conversation_id: string;
  initiator_id: string;
  recipient_id: string;
  type: StreakType;
  state: StreakState;
  progress_count: number;
  created_at: string;
  accepted_at?: string | null;
  accepted_by?: string | null;
  last_progress_at?: string | null;
  dormant_since?: string | null;
  ended_at?: string | null;
  ended_by?: string | null;
  end_reason?: StreakEndReason | null;
  state_changed_at: string;
  is_dormant?: boolean;
  has_qualifying_today?: boolean;
}

export interface TchatStreakParticipantDay {
  id: string;
  streak_id: string;
  user_id: string;
  local_date: string; // YYYY-MM-DD
  timezone_id: string; // IANA identifier (e.g., 'America/New_York')
  day_start_utc: string; // ISO 8601
  day_end_utc: string; // ISO 8601
  first_sent_at: string; // ISO 8601
  provenance_message_id?: string | null;
  provenance_media_id?: string | null;
  created_at: string;
}

export interface TchatStreakProgressDay {
  id: string;
  streak_id: string;
  participant_day_a_id: string;
  participant_day_b_id: string;
  user_a_id: string;
  user_b_id: string;
  user_a_local_date: string;
  user_b_local_date: string;
  qualified_at: string;
  created_at: string;
}

export interface StreakQualificationResult {
  qualified: boolean;
  progress_created?: boolean;
  streak_id?: string;
  progress_id?: string;
  new_progress_count?: number;
  state?: StreakState;
  reason?: string;
  error?: string;
}

export interface StreakServiceResult<T = void> {
  data?: T;
  error?: string;
  isSchemaPending?: boolean;
}

export type StreakEventType =
  | 'streak:initiated'
  | 'streak:accepted'
  | 'streak:declined'
  | 'streak:cancelled'
  | 'streak:progressed'
  | 'streak:dormant'
  | 'streak:ended';

export interface StreakEvent {
  type: StreakEventType;
  streak: TchatStreak;
  progressDay?: TchatStreakProgressDay;
  timestamp: string;
}
