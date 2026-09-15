-- ==============================================================================
-- Tchat: Streak Domain & Persistence Layer Migration
-- Migration: 20260915040000_create_tchat_streaks.sql
-- Description: Intentional, temporary, participation-based Streaks.
--              Supports 'chat', 'photo', and 'video' streak types per 1:1 conversation.
--              Enforces +1 progress rule via mutual qualifying interactions
--              across overlapping local calendar day UTC intervals.
--              Includes dormancy evaluation, race-safe pairing, historical permanence,
--              automatic lifecycle triggers on unfriend/block, and strict RLS.
-- ==============================================================================

-- 1. Create Streaks Table
CREATE TABLE IF NOT EXISTS public.streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  initiator_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('chat', 'photo', 'video')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'active', 'dormant', 'ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  state_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_progress_at TIMESTAMPTZ,
  dormant_since TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ended_by UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  end_reason TEXT CHECK (end_reason IN ('declined', 'cancelled', 'unfriended', 'blocked', 'manual_ended', 'system')),
  progress_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_streak_participants_distinct CHECK (initiator_id <> recipient_id)
);

-- Index for conversation lookups
CREATE INDEX IF NOT EXISTS idx_streaks_conversation ON public.streaks(conversation_id);
CREATE INDEX IF NOT EXISTS idx_streaks_initiator ON public.streaks(initiator_id);
CREATE INDEX IF NOT EXISTS idx_streaks_recipient ON public.streaks(recipient_id);
CREATE INDEX IF NOT EXISTS idx_streaks_state ON public.streaks(state);

-- Invariant: At most ONE non-ended Streak of a given type per conversation.
-- Multiple streak types ('chat', 'photo', 'video') can coexist simultaneously in the same conversation.
-- Ended streaks are retained historically and do not block initiating a new streak of the same type.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_streak_per_type 
  ON public.streaks (conversation_id, type) 
  WHERE state <> 'ended';

-- 2. Create Streak Participant Days Table
-- Represents a single participant's verified qualifying interaction on a specific local calendar day.
-- Provenance references (message_id, media_id) are ON DELETE SET NULL so historical progress survives content deletion or expiration.
CREATE TABLE IF NOT EXISTS public.streak_participant_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  streak_id UUID NOT NULL REFERENCES public.streaks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  timezone_id TEXT NOT NULL DEFAULT 'UTC',
  day_start_utc TIMESTAMPTZ NOT NULL,
  day_end_utc TIMESTAMPTZ NOT NULL,
  first_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provenance_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  provenance_media_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Invariant: Exactly one participant-day record per participant per local calendar date
  CONSTRAINT uq_streak_participant_day UNIQUE (streak_id, user_id, local_date),
  CONSTRAINT chk_streak_day_utc_valid CHECK (day_start_utc < day_end_utc)
);

CREATE INDEX IF NOT EXISTS idx_streak_participant_days_streak_user 
  ON public.streak_participant_days(streak_id, user_id);
CREATE INDEX IF NOT EXISTS idx_streak_participant_days_utc 
  ON public.streak_participant_days(day_start_utc, day_end_utc);

-- 3. Create Streak Progress Days Table
-- Represents an authoritative +1 progress event formed by pairing two unconsumed participant-day records
-- whose local calendar day UTC intervals overlap.
CREATE TABLE IF NOT EXISTS public.streak_progress_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  streak_id UUID NOT NULL REFERENCES public.streaks(id) ON DELETE CASCADE,
  participant_day_a_id UUID NOT NULL UNIQUE REFERENCES public.streak_participant_days(id) ON DELETE RESTRICT,
  participant_day_b_id UUID NOT NULL UNIQUE REFERENCES public.streak_participant_days(id) ON DELETE RESTRICT,
  user_a_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_b_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_a_local_date DATE NOT NULL,
  user_b_local_date DATE NOT NULL,
  qualified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_streak_progress_canonical_users CHECK (user_a_id < user_b_id),
  CONSTRAINT chk_streak_progress_distinct_days CHECK (participant_day_a_id <> participant_day_b_id)
);

CREATE INDEX IF NOT EXISTS idx_streak_progress_days_streak 
  ON public.streak_progress_days(streak_id);
CREATE INDEX IF NOT EXISTS idx_streak_progress_days_qualified 
  ON public.streak_progress_days(streak_id, qualified_at);

-- 4. Row Level Security (RLS)
ALTER TABLE public.streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streak_participant_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streak_progress_days ENABLE ROW LEVEL SECURITY;

-- Streaks SELECT policy
DROP POLICY IF EXISTS "Participants can view their conversation streaks" ON public.streaks;
CREATE POLICY "Participants can view their conversation streaks"
  ON public.streaks
  FOR SELECT
  TO authenticated
  USING (
    (initiator_id = auth.uid() OR recipient_id = auth.uid())
    AND NOT public.are_users_blocked(initiator_id, recipient_id)
  );

-- Streak Participant Days SELECT policy
DROP POLICY IF EXISTS "Participants can view streak participant days" ON public.streak_participant_days;
CREATE POLICY "Participants can view streak participant days"
  ON public.streak_participant_days
  FOR SELECT
  TO authenticated
  USING (
    streak_id IN (
      SELECT s.id FROM public.streaks s
      WHERE (s.initiator_id = auth.uid() OR s.recipient_id = auth.uid())
        AND NOT public.are_users_blocked(s.initiator_id, s.recipient_id)
    )
  );

-- Streak Progress Days SELECT policy
DROP POLICY IF EXISTS "Participants can view streak progress days" ON public.streak_progress_days;
CREATE POLICY "Participants can view streak progress days"
  ON public.streak_progress_days
  FOR SELECT
  TO authenticated
  USING (
    streak_id IN (
      SELECT s.id FROM public.streaks s
      WHERE (s.initiator_id = auth.uid() OR s.recipient_id = auth.uid())
        AND NOT public.are_users_blocked(s.initiator_id, s.recipient_id)
    )
  );

-- Revoke direct writes to ensure client cannot authoritatively mutate streaks or progress
REVOKE INSERT, UPDATE, DELETE ON public.streaks FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.streak_participant_days FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.streak_progress_days FROM anon, authenticated;

-- 5. Helper Function: Calculate Local Day UTC Bounds
-- Computes the local calendar date and corresponding UTC start/end timestamps
-- based on an IANA timezone identifier, falling back to 'UTC' if unrecognized.
CREATE OR REPLACE FUNCTION public.calculate_local_day_utc_bounds(
  p_timestamp TIMESTAMPTZ,
  p_timezone_id TEXT
)
RETURNS TABLE (
  local_date DATE,
  day_start_utc TIMESTAMPTZ,
  day_end_utc TIMESTAMPTZ,
  valid_tz TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tz TEXT;
  v_local_date DATE;
  v_start_utc TIMESTAMPTZ;
  v_end_utc TIMESTAMPTZ;
BEGIN
  -- Validate timezone against pg_timezone_names
  IF p_timezone_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE lower(name) = lower(p_timezone_id)
  ) THEN
    SELECT name INTO v_tz FROM pg_timezone_names WHERE lower(name) = lower(p_timezone_id) LIMIT 1;
  ELSE
    v_tz := 'UTC';
  END IF;

  -- Derive the participant's local calendar date at the moment of interaction
  v_local_date := (p_timestamp AT TIME ZONE v_tz)::date;

  -- Derive the exact UTC interval that begins and ends that participant's local calendar day
  v_start_utc := (v_local_date::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;
  v_end_utc := (v_local_date::text || ' 23:59:59.999999')::timestamp AT TIME ZONE v_tz;

  RETURN QUERY SELECT v_local_date, v_start_utc, v_end_utc, v_tz;
END;
$$;

-- 6. Core Server-Authoritative Qualification & Mutual Progress Pairing
-- Invoked atomically whenever a qualifying interaction (text message, photo, or video) is committed.
-- Handles:
-- 1. Idempotency per local day (multiple actions on same day do not produce duplicate participant-days).
-- 2. Race-safety (serializes mutual progress evaluation via FOR UPDATE lock on the streak row).
-- 3. Overlapping UTC day interval verification across timezones.
-- 4. Exact +1 progress pairing without double-consumption.
-- 5. Dormant streak reactivation upon mutual progress (dormant -> active).
CREATE OR REPLACE FUNCTION public.record_streak_qualifying_interaction(
  p_conversation_id UUID,
  p_sender_id UUID,
  p_streak_type TEXT,
  p_client_timezone TEXT DEFAULT 'UTC',
  p_message_id UUID DEFAULT NULL,
  p_media_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_streak RECORD;
  v_bounds RECORD;
  v_participant_day_id UUID;
  v_partner_id UUID;
  v_partner_day RECORD;
  v_day_a_id UUID;
  v_day_b_id UUID;
  v_user_a_id UUID;
  v_user_b_id UUID;
  v_user_a_date DATE;
  v_user_b_date DATE;
  v_progress_id UUID;
  v_new_count INT;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Find the active or dormant streak for this conversation and type
  SELECT * INTO v_streak
  FROM public.streaks
  WHERE conversation_id = p_conversation_id
    AND type = p_streak_type
    AND state IN ('active', 'dormant')
  FOR UPDATE; -- Lock streak row to serialize pairing and avoid race conditions

  IF NOT FOUND THEN
    -- No active/dormant streak of this type; nothing to qualify
    RETURN jsonb_build_object('qualified', false, 'reason', 'no_active_streak');
  END IF;

  -- 2. Verify sender is a participant
  IF v_streak.initiator_id <> p_sender_id AND v_streak.recipient_id <> p_sender_id THEN
    RETURN jsonb_build_object('qualified', false, 'reason', 'not_a_participant');
  END IF;

  v_partner_id := CASE 
    WHEN v_streak.initiator_id = p_sender_id THEN v_streak.recipient_id 
    ELSE v_streak.initiator_id 
  END;

  -- 3. Compute sender's local day UTC bounds
  SELECT * INTO v_bounds
  FROM public.calculate_local_day_utc_bounds(v_now, p_client_timezone);

  -- 4. Record participant-day record (idempotent ON CONFLICT)
  INSERT INTO public.streak_participant_days (
    streak_id,
    user_id,
    local_date,
    timezone_id,
    day_start_utc,
    day_end_utc,
    first_sent_at,
    provenance_message_id,
    provenance_media_id,
    created_at
  )
  VALUES (
    v_streak.id,
    p_sender_id,
    v_bounds.local_date,
    v_bounds.valid_tz,
    v_bounds.day_start_utc,
    v_bounds.day_end_utc,
    v_now,
    p_message_id,
    p_media_id,
    v_now
  )
  ON CONFLICT (streak_id, user_id, local_date) DO UPDATE
  SET timezone_id = EXCLUDED.timezone_id -- Preserve original first_sent_at and provenance
  RETURNING id INTO v_participant_day_id;

  -- 5. Check if sender's day record has already been consumed by an existing progress day
  IF EXISTS (
    SELECT 1 FROM public.streak_progress_days
    WHERE participant_day_a_id = v_participant_day_id 
       OR participant_day_b_id = v_participant_day_id
  ) THEN
    -- Sender already satisfied mutual progress for this local date
    RETURN jsonb_build_object(
      'qualified', true,
      'progress_created', false,
      'streak_id', v_streak.id,
      'state', v_streak.state,
      'reason', 'day_already_consumed'
    );
  END IF;

  -- 6. Search for an unconsumed qualifying day from partner whose UTC bounds overlap with sender's day
  -- Overlap condition: (A.day_start_utc < B.day_end_utc AND A.day_end_utc > B.day_start_utc)
  SELECT pd.* INTO v_partner_day
  FROM public.streak_participant_days pd
  WHERE pd.streak_id = v_streak.id
    AND pd.user_id = v_partner_id
    AND pd.day_start_utc < v_bounds.day_end_utc
    AND pd.day_end_utc > v_bounds.day_start_utc
    AND NOT EXISTS (
      SELECT 1 FROM public.streak_progress_days spd
      WHERE spd.participant_day_a_id = pd.id OR spd.participant_day_b_id = pd.id
    )
  ORDER BY pd.first_sent_at ASC, pd.id ASC
  LIMIT 1;

  -- 7. If no overlapping partner day exists, sender's action is recorded but no progress gained yet
  IF NOT FOUND THEN
    -- If streak is currently dormant, a unilateral action does NOT reactivate the streak.
    RETURN jsonb_build_object(
      'qualified', true,
      'progress_created', false,
      'streak_id', v_streak.id,
      'state', v_streak.state,
      'reason', 'waiting_for_partner_day'
    );
  END IF;

  -- 8. Mutual qualification met! Establish canonical participant A/B ordering
  IF p_sender_id < v_partner_id THEN
    v_day_a_id := v_participant_day_id;
    v_day_b_id := v_partner_day.id;
    v_user_a_id := p_sender_id;
    v_user_b_id := v_partner_id;
    v_user_a_date := v_bounds.local_date;
    v_user_b_date := v_partner_day.local_date;
  ELSE
    v_day_a_id := v_partner_day.id;
    v_day_b_id := v_participant_day_id;
    v_user_a_id := v_partner_id;
    v_user_b_id := p_sender_id;
    v_user_a_date := v_partner_day.local_date;
    v_user_b_date := v_bounds.local_date;
  END IF;

  -- Insert authoritative progress day row
  INSERT INTO public.streak_progress_days (
    streak_id,
    participant_day_a_id,
    participant_day_b_id,
    user_a_id,
    user_b_id,
    user_a_local_date,
    user_b_local_date,
    qualified_at,
    created_at
  )
  VALUES (
    v_streak.id,
    v_day_a_id,
    v_day_b_id,
    v_user_a_id,
    v_user_b_id,
    v_user_a_date,
    v_user_b_date,
    v_now,
    v_now
  )
  RETURNING id INTO v_progress_id;

  -- Authoritatively calculate total progress count
  SELECT count(*) INTO v_new_count
  FROM public.streak_progress_days
  WHERE streak_id = v_streak.id;

  -- Update streak: transition dormant -> active, clear dormant_since, update last_progress_at and count
  UPDATE public.streaks
  SET
    state = 'active',
    state_changed_at = CASE WHEN state = 'dormant' THEN v_now ELSE state_changed_at END,
    dormant_since = NULL,
    last_progress_at = v_now,
    progress_count = v_new_count,
    updated_at = v_now
  WHERE id = v_streak.id;

  RETURN jsonb_build_object(
    'qualified', true,
    'progress_created', true,
    'streak_id', v_streak.id,
    'progress_id', v_progress_id,
    'new_progress_count', v_new_count,
    'state', 'active'
  );
END;
$$;

-- 7. Authoritative Streak Lifecycle RPCs

-- 7.1 Initiate Streak
CREATE OR REPLACE FUNCTION public.initiate_streak(
  p_conversation_id UUID,
  p_type TEXT,
  p_client_timezone TEXT DEFAULT 'UTC'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_conv RECORD;
  v_recipient_id UUID;
  v_streak_id UUID;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_type NOT IN ('chat', 'photo', 'video') THEN
    RAISE EXCEPTION 'Invalid streak type: %. Allowed types are chat, photo, video.', p_type;
  END IF;

  -- Validate conversation and membership
  SELECT c.id, c.user_a_id, c.user_b_id, c.connection_id
  INTO v_conv
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found.';
  END IF;

  IF v_conv.user_a_id <> v_caller_id AND v_conv.user_b_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized: You are not a participant in this conversation.';
  END IF;

  v_recipient_id := CASE WHEN v_conv.user_a_id = v_caller_id THEN v_conv.user_b_id ELSE v_conv.user_a_id END;

  -- Block check
  IF public.are_users_blocked(v_caller_id, v_recipient_id) THEN
    RAISE EXCEPTION 'Cannot initiate streak: user is blocked.';
  END IF;

  -- Connection check
  IF NOT EXISTS (
    SELECT 1 FROM public.connections
    WHERE user_a_id = LEAST(v_caller_id, v_recipient_id) AND user_b_id = GREATEST(v_caller_id, v_recipient_id)
  ) THEN
    RAISE EXCEPTION 'Cannot initiate streak: active connection required.';
  END IF;

  -- Check if a non-ended streak of this type already exists
  IF EXISTS (
    SELECT 1 FROM public.streaks
    WHERE conversation_id = p_conversation_id
      AND type = p_type
      AND state <> 'ended'
  ) THEN
    RAISE EXCEPTION 'A streak of type % already exists in this conversation.', p_type;
  END IF;

  -- Insert pending streak
  INSERT INTO public.streaks (
    conversation_id,
    initiator_id,
    recipient_id,
    type,
    state,
    created_at,
    state_changed_at,
    progress_count,
    updated_at
  )
  VALUES (
    p_conversation_id,
    v_caller_id,
    v_recipient_id,
    p_type,
    'pending',
    now(),
    now(),
    0,
    now()
  )
  RETURNING id INTO v_streak_id;

  SELECT jsonb_build_object(
    'id', s.id,
    'conversation_id', s.conversation_id,
    'initiator_id', s.initiator_id,
    'recipient_id', s.recipient_id,
    'type', s.type,
    'state', s.state,
    'progress_count', s.progress_count,
    'created_at', s.created_at,
    'state_changed_at', s.state_changed_at
  ) INTO v_result
  FROM public.streaks s
  WHERE s.id = v_streak_id;

  RETURN v_result;
END;
$$;

-- 7.2 Accept Streak
CREATE OR REPLACE FUNCTION public.accept_streak(
  p_streak_id UUID,
  p_client_timezone TEXT DEFAULT 'UTC'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_streak RECORD;
  v_now TIMESTAMPTZ := now();
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_streak
  FROM public.streaks
  WHERE id = p_streak_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Streak not found.';
  END IF;

  IF v_streak.recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized: Only the recipient can accept this streak.';
  END IF;

  IF v_streak.state <> 'pending' THEN
    RAISE EXCEPTION 'Streak is not pending (current state: %).', v_streak.state;
  END IF;

  IF public.are_users_blocked(v_streak.initiator_id, v_streak.recipient_id) THEN
    RAISE EXCEPTION 'Cannot accept streak: relationship is blocked.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.connections
    WHERE user_a_id = LEAST(v_streak.initiator_id, v_streak.recipient_id)
      AND user_b_id = GREATEST(v_streak.initiator_id, v_streak.recipient_id)
  ) THEN
    RAISE EXCEPTION 'Cannot accept streak: connection no longer exists.';
  END IF;

  UPDATE public.streaks
  SET
    state = 'active',
    accepted_at = v_now,
    accepted_by = v_caller_id,
    state_changed_at = v_now,
    updated_at = v_now
  WHERE id = p_streak_id;

  SELECT jsonb_build_object(
    'id', s.id,
    'conversation_id', s.conversation_id,
    'initiator_id', s.initiator_id,
    'recipient_id', s.recipient_id,
    'type', s.type,
    'state', s.state,
    'progress_count', s.progress_count,
    'accepted_at', s.accepted_at,
    'accepted_by', s.accepted_by,
    'state_changed_at', s.state_changed_at
  ) INTO v_result
  FROM public.streaks s
  WHERE s.id = p_streak_id;

  RETURN v_result;
END;
$$;

-- 7.3 Decline Streak
CREATE OR REPLACE FUNCTION public.decline_streak(
  p_streak_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_streak RECORD;
  v_now TIMESTAMPTZ := now();
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_streak
  FROM public.streaks
  WHERE id = p_streak_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Streak not found.';
  END IF;

  IF v_streak.recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized to decline this streak.';
  END IF;

  IF v_streak.state <> 'pending' THEN
    RAISE EXCEPTION 'Streak is not pending (current state: %).', v_streak.state;
  END IF;

  UPDATE public.streaks
  SET
    state = 'ended',
    ended_at = v_now,
    ended_by = v_caller_id,
    end_reason = 'declined',
    state_changed_at = v_now,
    updated_at = v_now
  WHERE id = p_streak_id;

  RETURN jsonb_build_object('success', true, 'streak_id', p_streak_id, 'state', 'ended', 'end_reason', 'declined');
END;
$$;

-- 7.4 Cancel Streak (Initiator cancels before acceptance)
CREATE OR REPLACE FUNCTION public.cancel_streak(
  p_streak_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_streak RECORD;
  v_now TIMESTAMPTZ := now();
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_streak
  FROM public.streaks
  WHERE id = p_streak_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Streak not found.';
  END IF;

  IF v_streak.initiator_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized to cancel this streak.';
  END IF;

  IF v_streak.state <> 'pending' THEN
    RAISE EXCEPTION 'Streak is not pending (current state: %).', v_streak.state;
  END IF;

  UPDATE public.streaks
  SET
    state = 'ended',
    ended_at = v_now,
    ended_by = v_caller_id,
    end_reason = 'cancelled',
    state_changed_at = v_now,
    updated_at = v_now
  WHERE id = p_streak_id;

  RETURN jsonb_build_object('success', true, 'streak_id', p_streak_id, 'state', 'ended', 'end_reason', 'cancelled');
END;
$$;

-- 7.5 End Streak (Intentional termination by either participant)
CREATE OR REPLACE FUNCTION public.end_streak(
  p_streak_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_streak RECORD;
  v_now TIMESTAMPTZ := now();
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_streak
  FROM public.streaks
  WHERE id = p_streak_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Streak not found.';
  END IF;

  IF v_streak.initiator_id <> v_caller_id AND v_streak.recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized: You are not a participant in this streak.';
  END IF;

  IF v_streak.state = 'ended' THEN
    RETURN jsonb_build_object('success', true, 'streak_id', p_streak_id, 'state', 'ended', 'end_reason', v_streak.end_reason);
  END IF;

  UPDATE public.streaks
  SET
    state = 'ended',
    ended_at = v_now,
    ended_by = v_caller_id,
    end_reason = 'manual_ended',
    state_changed_at = v_now,
    updated_at = v_now
  WHERE id = p_streak_id;

  RETURN jsonb_build_object('success', true, 'streak_id', p_streak_id, 'state', 'ended', 'end_reason', 'manual_ended');
END;
$$;

-- 8. Dormancy Evaluation Mechanism
-- Evaluates active streaks against a configurable dormancy threshold (default 48 hours).
-- Dormancy rule: A Streak becomes dormant when no new mutual progress has occurred
-- for the configured dormancy threshold.
-- If no mutual progress has ever occurred after acceptance, uses accepted_at as the baseline.
-- Crucial: Dormancy NEVER resets or erases accumulated progress!
CREATE OR REPLACE FUNCTION public.evaluate_streak_dormancy(
  p_dormancy_threshold_hours INT DEFAULT 48
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_threshold INTERVAL := (p_dormancy_threshold_hours || ' hours')::interval;
  v_count INT := 0;
BEGIN
  UPDATE public.streaks
  SET
    state = 'dormant',
    dormant_since = v_now,
    state_changed_at = v_now,
    updated_at = v_now
  WHERE state = 'active'
    AND (
      (last_progress_at IS NOT NULL AND last_progress_at < (v_now - v_threshold))
      OR
      (last_progress_at IS NULL AND accepted_at IS NOT NULL AND accepted_at < (v_now - v_threshold))
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 9. Automatic Lifecycle Event Triggers on Unfriend & Block

-- 9.1 Connection Deletion Trigger
-- When an unfriend action occurs, all non-ended streaks for conversations between the pair become ended
CREATE OR REPLACE FUNCTION public.handle_connection_deleted_for_streaks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.streaks s
  SET
    state = 'ended',
    ended_at = now(),
    end_reason = 'unfriended',
    state_changed_at = now(),
    updated_at = now()
  FROM public.conversations c
  WHERE s.conversation_id = c.id
    AND s.state <> 'ended'
    AND ((c.user_a_id = OLD.user_a_id AND c.user_b_id = OLD.user_b_id)
      OR (c.user_a_id = OLD.user_b_id AND c.user_b_id = OLD.user_a_id));

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_connection_deleted_streaks ON public.connections;
CREATE TRIGGER trg_connection_deleted_streaks
  AFTER DELETE ON public.connections
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_connection_deleted_for_streaks();

-- 9.2 Block Created Trigger
-- When a user blocks another user, all non-ended streaks between them are ended with end_reason = 'blocked'
CREATE OR REPLACE FUNCTION public.handle_block_created_for_streaks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.streaks s
  SET
    state = 'ended',
    ended_at = now(),
    ended_by = NEW.blocker_id,
    end_reason = 'blocked',
    state_changed_at = now(),
    updated_at = now()
  FROM public.conversations c
  WHERE s.conversation_id = c.id
    AND s.state <> 'ended'
    AND ((c.user_a_id = NEW.blocker_id AND c.user_b_id = NEW.blocked_id)
      OR (c.user_a_id = NEW.blocked_id AND c.user_b_id = NEW.blocker_id));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_created_streaks ON public.blocks;
CREATE TRIGGER trg_block_created_streaks
  AFTER INSERT ON public.blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_block_created_for_streaks();

-- 10. Query RPCs for Front-End Consumption

-- 10.1 Get Conversation Streaks
CREATE OR REPLACE FUNCTION public.get_conversation_streaks(
  p_conversation_id UUID
)
RETURNS TABLE (
  id UUID,
  conversation_id UUID,
  initiator_id UUID,
  recipient_id UUID,
  type TEXT,
  state TEXT,
  progress_count INT,
  created_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID,
  last_progress_at TIMESTAMPTZ,
  dormant_since TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ended_by UUID,
  end_reason TEXT,
  state_changed_at TIMESTAMPTZ,
  is_dormant BOOLEAN,
  has_qualifying_today BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_conv RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT c.user_a_id, c.user_b_id INTO v_conv
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found.';
  END IF;

  IF v_conv.user_a_id <> v_caller_id AND v_conv.user_b_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized to view streaks in this conversation.';
  END IF;

  RETURN QUERY
  SELECT 
    s.id,
    s.conversation_id,
    s.initiator_id,
    s.recipient_id,
    s.type,
    s.state,
    s.progress_count,
    s.created_at,
    s.accepted_at,
    s.accepted_by,
    s.last_progress_at,
    s.dormant_since,
    s.ended_at,
    s.ended_by,
    s.end_reason,
    s.state_changed_at,
    (s.state = 'dormant') AS is_dormant,
    EXISTS (
      SELECT 1 FROM public.streak_participant_days spd
      WHERE spd.streak_id = s.id
        AND spd.user_id = v_caller_id
        AND spd.local_date = (now() AT TIME ZONE spd.timezone_id)::date
    ) AS has_qualifying_today
  FROM public.streaks s
  WHERE s.conversation_id = p_conversation_id
  ORDER BY 
    CASE s.state
      WHEN 'active' THEN 1
      WHEN 'dormant' THEN 2
      WHEN 'pending' THEN 3
      ELSE 4
    END,
    s.created_at DESC;
END;
$$;

-- 10.2 Get Streak Progress History
CREATE OR REPLACE FUNCTION public.get_streak_progress_history(
  p_streak_id UUID,
  p_limit INT DEFAULT 30
)
RETURNS TABLE (
  id UUID,
  streak_id UUID,
  user_a_id UUID,
  user_b_id UUID,
  user_a_local_date DATE,
  user_b_local_date DATE,
  qualified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_streak RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_streak
  FROM public.streaks
  WHERE id = p_streak_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Streak not found.';
  END IF;

  IF v_streak.initiator_id <> v_caller_id AND v_streak.recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized to view history for this streak.';
  END IF;

  RETURN QUERY
  SELECT 
    spd.id,
    spd.streak_id,
    spd.user_a_id,
    spd.user_b_id,
    spd.user_a_local_date,
    spd.user_b_local_date,
    spd.qualified_at,
    spd.created_at
  FROM public.streak_progress_days spd
  WHERE spd.streak_id = p_streak_id
  ORDER BY spd.qualified_at DESC
  LIMIT LEAST(p_limit, 100);
END;
$$;

-- 11. Hook Streak Qualification into Authoritative Send Message RPC
-- Extends send_message to automatically evaluate and record qualifying streak interaction
-- when a text message, photo, or video is sent.
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id UUID,
  p_content TEXT,
  p_message_type TEXT DEFAULT 'text',
  p_media_asset_id UUID DEFAULT NULL,
  p_client_timezone TEXT DEFAULT 'UTC'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_conv RECORD;
  v_other_id UUID;
  v_clean_content TEXT;
  v_msg_id UUID;
  v_seq BIGINT;
  v_created_at TIMESTAMPTZ;
  v_media_record RECORD;
  v_media_preview TEXT;
  v_qualifying_streak_type TEXT := NULL;
  v_streak_eval JSONB;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Validate conversation exists and caller is a participant
  SELECT c.id, c.user_a_id, c.user_b_id, c.connection_id
  INTO v_conv
  FROM public.conversations c
  WHERE c.id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found.';
  END IF;

  IF v_conv.user_a_id <> v_caller_id AND v_conv.user_b_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized: You are not a participant in this conversation.';
  END IF;

  v_other_id := CASE WHEN v_conv.user_a_id = v_caller_id THEN v_conv.user_b_id ELSE v_conv.user_a_id END;

  -- 2. Check blocks (bidirectional)
  IF public.are_users_blocked(v_caller_id, v_other_id) THEN
    RAISE EXCEPTION 'Cannot send message: user is blocked.';
  END IF;

  -- 3. Check connection is still active
  IF NOT EXISTS (
    SELECT 1 FROM public.connections
    WHERE (user_a_id = LEAST(v_caller_id, v_other_id) AND user_b_id = GREATEST(v_caller_id, v_other_id))
  ) THEN
    RAISE EXCEPTION 'Cannot send message: connection no longer exists.';
  END IF;

  -- 4. Validate content & media association
  IF p_message_type = 'text' THEN
    v_clean_content := trim(p_content);
    IF v_clean_content IS NULL OR char_length(v_clean_content) < 1 THEN
      RAISE EXCEPTION 'Message content cannot be empty.';
    END IF;
    IF char_length(p_content) > 2000 THEN
      RAISE EXCEPTION 'Message content exceeds maximum length of 2000 characters.';
    END IF;
    v_media_preview := substring(v_clean_content from 1 for 100);
    v_qualifying_streak_type := 'chat';
  ELSIF p_message_type = 'media' THEN
    IF p_media_asset_id IS NULL THEN
      RAISE EXCEPTION 'Media message requires a media_asset_id.';
    END IF;

    -- Verify media asset exists, belongs to this conversation and was uploaded by caller
    SELECT * INTO v_media_record
    FROM public.media_assets
    WHERE id = p_media_asset_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Associated media asset not found.';
    END IF;

    IF v_media_record.uploader_id <> v_caller_id THEN
      RAISE EXCEPTION 'You are not the uploader of this media asset.';
    END IF;

    IF v_media_record.conversation_id <> p_conversation_id THEN
      RAISE EXCEPTION 'Media asset belongs to another conversation.';
    END IF;

    v_clean_content := NULLIF(trim(COALESCE(p_content, '')), '');
    IF v_clean_content IS NOT NULL AND char_length(v_clean_content) > 2000 THEN
      RAISE EXCEPTION 'Media caption exceeds maximum length of 2000 characters.';
    END IF;

    v_media_preview := COALESCE(
      v_clean_content,
      CASE v_media_record.media_type
        WHEN 'image' THEN '[Photo]'
        WHEN 'video' THEN '[Video]'
        WHEN 'audio' THEN '[Audio]'
        ELSE '[File]'
      END
    );

    -- Map media type to qualifying streak type
    IF v_media_record.media_type = 'image' THEN
      v_qualifying_streak_type := 'photo';
    ELSIF v_media_record.media_type = 'video' THEN
      v_qualifying_streak_type := 'video';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported message type: %', p_message_type;
  END IF;

  -- 5. Insert message with server-authoritative timestamp & initial status 'sent'
  INSERT INTO public.messages (
    conversation_id,
    sender_id,
    message_type,
    content,
    media_asset_id,
    status,
    created_at
  )
  VALUES (
    p_conversation_id,
    v_caller_id,
    p_message_type,
    v_clean_content,
    p_media_asset_id,
    'sent',
    now()
  )
  RETURNING id, sequence_number, created_at INTO v_msg_id, v_seq, v_created_at;

  -- 6. Link message_id to media_assets
  IF p_media_asset_id IS NOT NULL THEN
    UPDATE public.media_assets
    SET message_id = v_msg_id, updated_at = now()
    WHERE id = p_media_asset_id;
  END IF;

  -- 7. Update conversation activity (Home today's conversations surfacing)
  UPDATE public.conversations
  SET 
    last_activity_at = v_created_at,
    last_activity_type = p_message_type,
    last_message_preview = v_media_preview,
    last_sender_id = v_caller_id,
    updated_at = v_created_at
  WHERE id = p_conversation_id;

  -- 8. Authoritative Streak Qualification Hook
  IF v_qualifying_streak_type IS NOT NULL THEN
    BEGIN
      v_streak_eval := public.record_streak_qualifying_interaction(
        p_conversation_id := p_conversation_id,
        p_sender_id := v_caller_id,
        p_streak_type := v_qualifying_streak_type,
        p_client_timezone := COALESCE(p_client_timezone, 'UTC'),
        p_message_id := v_msg_id,
        p_media_id := p_media_asset_id
      );
    EXCEPTION WHEN OTHERS THEN
      -- Safeguard: Streak evaluation error must never prevent message delivery
      RAISE WARNING 'Streak qualification hook warning: %', SQLERRM;
      v_streak_eval := jsonb_build_object('qualified', false, 'error', SQLERRM);
    END;
  END IF;

  -- 9. Return complete message object with media asset details & streak evaluation summary
  SELECT jsonb_build_object(
    'id', m.id,
    'conversation_id', m.conversation_id,
    'sender_id', m.sender_id,
    'message_type', m.message_type,
    'content', m.content,
    'media_asset_id', m.media_asset_id,
    'sequence_number', m.sequence_number,
    'status', m.status,
    'delivered_at', m.delivered_at,
    'read_at', m.read_at,
    'created_at', m.created_at,
    'media', CASE WHEN ma.id IS NOT NULL THEN jsonb_build_object(
      'id', ma.id,
      'uploader_id', ma.uploader_id,
      'storage_path', CASE WHEN ma.is_saved = true OR ma.expires_at > now() THEN ma.storage_path ELSE NULL END,
      'media_type', ma.media_type,
      'mime_type', ma.mime_type,
      'file_size_bytes', ma.file_size_bytes,
      'original_filename', ma.original_filename,
      'allow_recipient_save', ma.allow_recipient_save,
      'is_saved', ma.is_saved,
      'saved_at', ma.saved_at,
      'saved_by_id', ma.saved_by_id,
      'expires_at', ma.expires_at,
      'created_at', ma.created_at,
      'is_expired', (ma.expires_at <= now() AND NOT ma.is_saved)
    ) ELSE NULL END,
    'streak_evaluation', v_streak_eval
  ) INTO v_result
  FROM public.messages m
  LEFT JOIN public.media_assets ma ON ma.id = m.media_asset_id
  WHERE m.id = v_msg_id;

  RETURN v_result;
END;
$$;

-- 12. Permissions Grant
GRANT SELECT ON public.streaks TO authenticated;
GRANT SELECT ON public.streak_participant_days TO authenticated;
GRANT SELECT ON public.streak_progress_days TO authenticated;

GRANT EXECUTE ON FUNCTION public.calculate_local_day_utc_bounds(TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_streak_qualifying_interaction(UUID, UUID, TEXT, TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_streak(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_streak(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_streak(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_streak(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_streak(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_streak_dormancy(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_streaks(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_streak_progress_history(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_message(UUID, TEXT, TEXT, UUID, TEXT) TO authenticated;
