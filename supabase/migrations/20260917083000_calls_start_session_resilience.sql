-- Migration: 20260917083000_calls_start_session_resilience.sql
-- Description: Enhances start_call_session to permit 'connected' calls and reuse active sessions,
-- preventing race conditions between peers during WebRTC connection establishment.

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

  -- 3. Verify call is in an active session-eligible state (accepted, connecting, or connected)
  IF v_call.status NOT IN ('accepted', 'connecting', 'connected') THEN
    RAISE EXCEPTION 'Cannot start session: Call is in "%" status (must be accepted, connecting, or connected).', v_call.status;
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

  -- 5. Reuse active connecting/connected session if ongoing
  SELECT *
  INTO v_existing_session
  FROM public.call_sessions
  WHERE call_id = p_call_id
    AND status IN ('connecting', 'connected')
    AND ended_at IS NULL
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

  -- 7. Update call status to connecting if accepted
  IF v_call.status = 'accepted' THEN
    UPDATE public.calls
    SET status = 'connecting', updated_at = now()
    WHERE id = p_call_id;
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'call_id', p_call_id,
    'status', v_session.status,
    'started_at', v_session.started_at
  );
END;
$$;
