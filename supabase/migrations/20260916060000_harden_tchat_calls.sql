-- ==============================================================================
-- Tchat: Calls Domain — Phase 1 Hardening: Server-Controlled Expiration & Concurrent Creation Safety
-- Migration: 20260916060000_harden_tchat_calls.sql
-- Description:
-- 1. Enforces server-controlled expiration policy (strictly 120 seconds in Phase 1).
--    Client callers cannot choose arbitrary expiration durations.
-- 2. Hardens concurrent pending-call creation against race conditions.
--    Catches unique_violation on idx_unique_pending_call_per_conv and translates
--    it into clean domain-level exception 'A call request is already pending in this conversation.'
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.create_call_request(
  p_conversation_id UUID,
  p_preset_reason TEXT DEFAULT NULL,
  p_custom_reason TEXT DEFAULT NULL,
  p_expires_in_seconds INT DEFAULT 120,
  p_mode TEXT DEFAULT 'immediate'
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
  v_clean_preset TEXT;
  v_clean_custom TEXT;
  v_expires_at TIMESTAMPTZ;
  v_expiration_seconds CONSTANT INT := 120; -- Server-controlled policy: strictly 120s
  v_existing_pending RECORD;
  v_call_id UUID;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Phase 1 restriction: only immediate call mode is supported
  IF p_mode IS DISTINCT FROM 'immediate' THEN
    RAISE EXCEPTION 'Phase 1 only supports immediate call requests.';
  END IF;

  -- 1. Conversation membership check
  SELECT c.id, c.user_a_id, c.user_b_id
  INTO v_conv
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found.';
  END IF;

  IF v_conv.user_a_id <> v_caller_id AND v_conv.user_b_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized: You are not a participant in this conversation.';
  END IF;

  v_recipient_id := CASE 
    WHEN v_conv.user_a_id = v_caller_id THEN v_conv.user_b_id 
    ELSE v_conv.user_a_id 
  END;

  IF v_caller_id = v_recipient_id THEN
    RAISE EXCEPTION 'Cannot initiate a call with yourself.';
  END IF;

  -- 2. Bidirectional block check
  IF public.are_users_blocked(v_caller_id, v_recipient_id) THEN
    RAISE EXCEPTION 'Cannot request call: relationship is blocked.';
  END IF;

  -- 3. Confirmed connection check
  IF NOT EXISTS (
    SELECT 1 FROM public.connections
    WHERE (user_a_id = LEAST(v_caller_id, v_recipient_id) AND user_b_id = GREATEST(v_caller_id, v_recipient_id))
  ) THEN
    RAISE EXCEPTION 'Cannot request call: You are not connected with this user.';
  END IF;

  -- 4. Reason validation
  v_clean_preset := NULLIF(trim(COALESCE(p_preset_reason, '')), '');
  v_clean_custom := NULLIF(trim(COALESCE(p_custom_reason, '')), '');

  IF v_clean_preset IS NULL AND v_clean_custom IS NULL THEN
    RAISE EXCEPTION 'A call reason is required. Please provide a preset reason or custom note.';
  END IF;

  IF v_clean_custom IS NOT NULL AND char_length(v_clean_custom) > 300 THEN
    RAISE EXCEPTION 'Custom call reason exceeds maximum allowed length of 300 characters.';
  END IF;

  -- 5. Expiration calculation (Phase 1: strictly server-controlled at 120 seconds)
  -- The client cannot choose a shorter or longer expiration.
  v_expires_at := now() + (v_expiration_seconds || ' seconds')::interval;

  -- 6. Check for existing pending call in conversation
  SELECT id, request_expires_at INTO v_existing_pending
  FROM public.calls
  WHERE conversation_id = p_conversation_id AND status = 'pending'
  FOR UPDATE;

  IF FOUND THEN
    -- If the existing pending call has expired past its expiration time, transition it to 'expired'
    IF v_existing_pending.request_expires_at <= now() THEN
      UPDATE public.calls
      SET status = 'expired', outcome = 'expired', updated_at = now()
      WHERE id = v_existing_pending.id;
    ELSE
      RAISE EXCEPTION 'A call request is already pending in this conversation.';
    END IF;
  END IF;

  -- 7. Insert the pending call record with race-safe unique violation handling
  BEGIN
    INSERT INTO public.calls (
      conversation_id,
      initiator_id,
      recipient_id,
      mode,
      preset_reason,
      custom_reason,
      request_expires_at,
      status,
      created_at,
      updated_at
    )
    VALUES (
      p_conversation_id,
      v_caller_id,
      v_recipient_id,
      'immediate',
      v_clean_preset,
      v_clean_custom,
      v_expires_at,
      'pending',
      now(),
      now()
    )
    RETURNING id INTO v_call_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- Catches concurrent race condition on idx_unique_pending_call_per_conv
      -- and translates to domain exception
      RAISE EXCEPTION 'A call request is already pending in this conversation.';
  END;

  -- 8. Return formatted JSON result
  SELECT jsonb_build_object(
    'id', c.id,
    'conversation_id', c.conversation_id,
    'initiator_id', c.initiator_id,
    'recipient_id', c.recipient_id,
    'mode', c.mode,
    'preset_reason', c.preset_reason,
    'custom_reason', c.custom_reason,
    'request_expires_at', c.request_expires_at,
    'status', c.status,
    'outcome', c.outcome,
    'started_at', c.started_at,
    'ended_at', c.ended_at,
    'created_at', c.created_at,
    'updated_at', c.updated_at
  ) INTO v_result
  FROM public.calls c
  WHERE c.id = v_call_id;

  RETURN v_result;
END;
$$;

-- Ensure execution permissions
GRANT EXECUTE ON FUNCTION public.create_call_request(UUID, TEXT, TEXT, INT, TEXT) TO authenticated;
