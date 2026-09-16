-- ==============================================================================
-- Tchat: Calls Domain — Phase 2: WebRTC / Audio Calling Foundation
-- Migration: 20260916070000_calls_phase2_webrtc_signaling.sql
-- Description: Establishes the technical session lifecycle, database security,
--              and private Supabase Realtime signaling authorization for 1:1 audio calls.
--              Lifecycle: Accepted -> Connecting (start session) -> Connected (confirm connection) -> Ended.
--              Technical failure in session reverts call from connecting to accepted.
-- ==============================================================================

-- 1. Enhance call_sessions table with technical status and connected_at
ALTER TABLE public.call_sessions 
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'connecting' 
  CHECK (status IN ('connecting', 'connected', 'ended', 'failed'));

ALTER TABLE public.call_sessions 
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_call_sessions_status ON public.call_sessions(status);
CREATE INDEX IF NOT EXISTS idx_call_sessions_call_active ON public.call_sessions(call_id) WHERE ended_at IS NULL;

-- Ensure RLS on call_sessions
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view their call sessions" ON public.call_sessions;
CREATE POLICY "Participants can view their call sessions"
  ON public.call_sessions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.calls c
      WHERE c.id = call_sessions.call_id
        AND (c.initiator_id = auth.uid() OR c.recipient_id = auth.uid())
    )
  );

-- Revoke direct mutations
REVOKE ALL ON public.call_sessions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.call_sessions FROM authenticated;
GRANT SELECT ON public.call_sessions TO authenticated;

-- 2. Realtime Signaling Channel Authorization Function
-- Authorizes joining and broadcasting on 'calls:signaling:<call_id>'
CREATE OR REPLACE FUNCTION public.authorize_call_signaling_topic(p_topic TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_call_id_text TEXT;
  v_call_id UUID;
  v_call RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_topic IS NULL OR p_topic NOT LIKE 'calls:signaling:%' THEN
    RETURN false;
  END IF;

  v_call_id_text := split_part(p_topic, ':', 3);
  
  BEGIN
    v_call_id := v_call_id_text::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  -- Call must exist and caller must be participant
  SELECT id, initiator_id, recipient_id, status INTO v_call
  FROM public.calls
  WHERE id = v_call_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_call.initiator_id <> v_caller_id AND v_call.recipient_id <> v_caller_id THEN
    RETURN false;
  END IF;

  -- Call must be in an active session-eligible state
  IF v_call.status NOT IN ('accepted', 'connecting', 'connected') THEN
    RETURN false;
  END IF;

  -- Safety: blocked check
  IF public.are_users_blocked(v_call.initiator_id, v_call.recipient_id) THEN
    RETURN false;
  END IF;

  -- Safety: connection check
  IF NOT EXISTS (
    SELECT 1 FROM public.connections
    WHERE user_a_id = LEAST(v_call.initiator_id, v_call.recipient_id)
      AND user_b_id = GREATEST(v_call.initiator_id, v_call.recipient_id)
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- 3. Configure RLS Policies on realtime.messages for Private Signaling Channels
-- Ensures a user cannot join or broadcast on a signaling channel by guessing call/conversation ID.
DROP POLICY IF EXISTS "calls_signaling_receive_policy" ON realtime.messages;
CREATE POLICY "calls_signaling_receive_policy"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    CASE 
      WHEN COALESCE(realtime.topic(), topic) LIKE 'calls:signaling:%' 
      THEN public.authorize_call_signaling_topic(COALESCE(realtime.topic(), topic))
      ELSE true
    END
  );

DROP POLICY IF EXISTS "calls_signaling_send_policy" ON realtime.messages;
CREATE POLICY "calls_signaling_send_policy"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE 
      WHEN COALESCE(realtime.topic(), topic) LIKE 'calls:signaling:%' 
      THEN public.authorize_call_signaling_topic(COALESCE(realtime.topic(), topic))
      ELSE true
    END
  );

-- 4. Secure RPC: Start Call Session (Creates a technical connection attempt)
CREATE OR REPLACE FUNCTION public.start_call_session(
  p_call_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_call RECORD;
  v_session RECORD;
  v_existing_session RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Row-lock call record
  SELECT *
  INTO v_call
  FROM public.calls
  WHERE id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Call not found.';
  END IF;

  -- 2. Verify caller is participant
  IF v_call.initiator_id <> v_caller_id AND v_call.recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized: Caller is not a participant in this call.';
  END IF;

  -- 3. Verify call is in accepted or connecting state
  IF v_call.status NOT IN ('accepted', 'connecting') THEN
    RAISE EXCEPTION 'Cannot start session: Call is in "%" status (must be accepted or connecting).', v_call.status;
  END IF;

  -- 4. Verify safety checks
  IF public.are_users_blocked(v_call.initiator_id, v_call.recipient_id) THEN
    UPDATE public.calls
    SET status = 'cancelled', outcome = 'blocked', updated_at = now()
    WHERE id = p_call_id;
    RAISE EXCEPTION 'Cannot start call session: Relationship is blocked.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.connections
    WHERE user_a_id = LEAST(v_call.initiator_id, v_call.recipient_id)
      AND user_b_id = GREATEST(v_call.initiator_id, v_call.recipient_id)
  ) THEN
    UPDATE public.calls
    SET status = 'cancelled', outcome = 'unfriended', updated_at = now()
    WHERE id = p_call_id;
    RAISE EXCEPTION 'Cannot start call session: Connection no longer exists.';
  END IF;

  -- 5. Reuse active connecting session if created recently (< 30 seconds)
  SELECT *
  INTO v_existing_session
  FROM public.call_sessions
  WHERE call_id = p_call_id
    AND status = 'connecting'
    AND ended_at IS NULL
    AND started_at >= now() - INTERVAL '30 seconds'
  ORDER BY started_at DESC
  LIMIT 1;

  IF FOUND THEN
    -- Transition call to connecting if still accepted
    IF v_call.status = 'accepted' THEN
      UPDATE public.calls
      SET status = 'connecting', updated_at = now()
      WHERE id = p_call_id;
    END IF;

    RETURN jsonb_build_object(
      'session_id', v_existing_session.id,
      'call_id', p_call_id,
      'status', v_existing_session.status,
      'started_at', v_existing_session.started_at
    );
  END IF;

  -- 6. Otherwise create new call_session
  INSERT INTO public.call_sessions (
    call_id,
    status,
    started_at
  )
  VALUES (
    p_call_id,
    'connecting',
    now()
  )
  RETURNING * INTO v_session;

  -- 7. Update call status to connecting
  UPDATE public.calls
  SET status = 'connecting', updated_at = now()
  WHERE id = p_call_id;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'call_id', p_call_id,
    'status', v_session.status,
    'started_at', v_session.started_at
  );
END;
$$;

-- 5. Secure RPC: Confirm Call Connection (WebRTC connected)
CREATE OR REPLACE FUNCTION public.confirm_call_connection(
  p_call_id UUID,
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_call RECORD;
  v_session RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Row-lock call record
  SELECT *
  INTO v_call
  FROM public.calls
  WHERE id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Call not found.';
  END IF;

  -- 2. Verify caller is participant
  IF v_call.initiator_id <> v_caller_id AND v_call.recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized: Caller is not a participant in this call.';
  END IF;

  -- 3. Verify status allows confirmation
  IF v_call.status NOT IN ('connecting', 'connected') THEN
    RAISE EXCEPTION 'Cannot confirm call: Call is in "%" status (must be connecting or connected).', v_call.status;
  END IF;

  -- 4. Row-lock session record
  SELECT *
  INTO v_session
  FROM public.call_sessions
  WHERE id = p_session_id AND call_id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Call session not found for this call.';
  END IF;

  -- 5. Safety checks
  IF public.are_users_blocked(v_call.initiator_id, v_call.recipient_id) THEN
    UPDATE public.calls
    SET status = 'cancelled', outcome = 'blocked', updated_at = now()
    WHERE id = p_call_id;
    RAISE EXCEPTION 'Cannot confirm call: Relationship is blocked.';
  END IF;

  -- 6. Mark call as connected
  UPDATE public.calls
  SET
    status = 'connected',
    started_at = COALESCE(started_at, now()),
    updated_at = now()
  WHERE id = p_call_id;

  -- 7. Mark session as connected
  UPDATE public.call_sessions
  SET
    status = 'connected',
    connected_at = COALESCE(connected_at, now())
  WHERE id = p_session_id;

  -- 8. Update conversation activity
  UPDATE public.conversations
  SET
    last_activity_at = now(),
    last_activity_type = 'call',
    updated_at = now()
  WHERE id = v_call.conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'call_id', p_call_id,
    'session_id', p_session_id,
    'status', 'connected',
    'started_at', COALESCE(v_call.started_at, now())
  );
END;
$$;

-- 6. Secure RPC: Record Call Session Failure (Technical attempt failed)
-- Invariant: Technical session failure reverts call from connecting back to accepted
-- without terminally destroying the durable social call agreement.
CREATE OR REPLACE FUNCTION public.record_call_session_failure(
  p_call_id UUID,
  p_session_id UUID,
  p_reason TEXT DEFAULT 'failed'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_call RECORD;
  v_session RECORD;
  v_clean_outcome TEXT;
  v_new_call_status TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Row-lock call record
  SELECT *
  INTO v_call
  FROM public.calls
  WHERE id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Call not found.';
  END IF;

  -- 2. Verify caller is participant
  IF v_call.initiator_id <> v_caller_id AND v_call.recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized: Caller is not a participant in this call.';
  END IF;

  -- 3. Row-lock session record
  SELECT *
  INTO v_session
  FROM public.call_sessions
  WHERE id = p_session_id AND call_id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Call session not found for this call.';
  END IF;

  -- 4. Normalize outcome
  v_clean_outcome := lower(trim(COALESCE(p_reason, 'failed')));
  IF v_clean_outcome NOT IN ('failed', 'network_error', 'abandoned') THEN
    v_clean_outcome := 'failed';
  END IF;

  -- 5. Update session
  UPDATE public.call_sessions
  SET
    status = 'failed',
    ended_at = now(),
    outcome = v_clean_outcome
  WHERE id = p_session_id;

  -- 6. Invariant: If durable call was in 'connecting' status, revert it to 'accepted'.
  -- If call was already 'connected', it remains 'connected' unless explicitly ended.
  v_new_call_status := v_call.status;
  IF v_call.status = 'connecting' THEN
    v_new_call_status := 'accepted';
    UPDATE public.calls
    SET status = 'accepted', updated_at = now()
    WHERE id = p_call_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'call_id', p_call_id,
    'session_id', p_session_id,
    'session_status', 'failed',
    'session_outcome', v_clean_outcome,
    'call_status', v_new_call_status
  );
END;
$$;

-- 7. Secure RPC: End Call Session (Hang up / terminal completion)
CREATE OR REPLACE FUNCTION public.end_call_session(
  p_call_id UUID,
  p_session_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_call RECORD;
  v_outcome TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Row-lock call record
  SELECT *
  INTO v_call
  FROM public.calls
  WHERE id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Call not found.';
  END IF;

  -- 2. Verify caller is participant
  IF v_call.initiator_id <> v_caller_id AND v_call.recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized: Caller is not a participant in this call.';
  END IF;

  -- If call is already in a terminal state, return current state
  IF v_call.status IN ('ended', 'declined', 'cancelled', 'expired', 'missed', 'failed') THEN
    RETURN jsonb_build_object(
      'success', true,
      'call_id', p_call_id,
      'status', v_call.status,
      'already_terminal', true
    );
  END IF;

  v_outcome := CASE 
    WHEN v_call.started_at IS NOT NULL OR v_call.status = 'connected' THEN 'completed'
    ELSE 'cancelled'
  END;

  -- 3. Update call record to ended
  UPDATE public.calls
  SET
    status = 'ended',
    outcome = v_outcome,
    ended_at = now(),
    updated_at = now()
  WHERE id = p_call_id;

  -- 4. Close any open call sessions
  UPDATE public.call_sessions
  SET
    status = 'ended',
    ended_at = now(),
    outcome = CASE WHEN v_call.status = 'connected' OR status = 'connected' THEN 'success' ELSE 'abandoned' END
  WHERE call_id = p_call_id
    AND ended_at IS NULL;

  -- 5. Update conversation activity timestamp
  UPDATE public.conversations
  SET
    last_activity_at = now(),
    updated_at = now()
  WHERE id = v_call.conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'call_id', p_call_id,
    'status', 'ended',
    'outcome', v_outcome,
    'ended_at', now()
  );
END;
$$;

-- 8. Grant execution permissions
GRANT EXECUTE ON FUNCTION public.authorize_call_signaling_topic(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_call_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_call_connection(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_call_session_failure(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_call_session(UUID, UUID) TO authenticated;
