-- ==============================================================================
-- Tchat: Calls Domain — Phase 1: Core Schema + Immediate Call Requests
-- Migration: 20260916050000_create_tchat_calls.sql
-- Description: Durable foundation for intentional, permission-based Calls.
--              Lifecycle: Connection -> Immediate Call Request -> Accepted/Declined/Cancelled/Expired.
--              Enforces mandatory context/reason, participant & connection verification,
--              bidirectional safety blocks check, row-locked race-safe response mutations,
--              provisional expiration handling, and automatic cancellation on unfriend/block.
-- ==============================================================================

-- 1. Create Calls Table
CREATE TABLE IF NOT EXISTS public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  initiator_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'immediate' CHECK (mode IN ('immediate', 'scheduled')),
  preset_reason TEXT,
  custom_reason TEXT,
  request_expires_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'accepted',
    'scheduled',
    'connecting',
    'connected',
    'ended',
    'declined',
    'cancelled',
    'expired',
    'missed',
    'failed'
  )),
  outcome TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Invariants
  CONSTRAINT chk_call_participants_distinct CHECK (initiator_id <> recipient_id),
  CONSTRAINT chk_call_reason_required CHECK (
    (preset_reason IS NOT NULL AND trim(preset_reason) <> '') OR
    (custom_reason IS NOT NULL AND trim(custom_reason) <> '')
  ),
  CONSTRAINT chk_immediate_call_has_expiration CHECK (
    mode <> 'immediate' OR request_expires_at IS NOT NULL
  ),
  CONSTRAINT chk_scheduled_call_has_time CHECK (
    mode <> 'scheduled' OR scheduled_at IS NOT NULL
  )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_calls_conversation ON public.calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_calls_initiator ON public.calls(initiator_id);
CREATE INDEX IF NOT EXISTS idx_calls_recipient ON public.calls(recipient_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON public.calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_expires_at ON public.calls(request_expires_at) WHERE status = 'pending';

-- Invariant: At most ONE pending call per conversation at any given time.
-- This prevents concurrent pending call spam and race conditions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_pending_call_per_conv
  ON public.calls (conversation_id)
  WHERE status = 'pending';

-- 2. Create Call Sessions Technical Foundation Table
-- Establishes the technical session boundary for future WebRTC connection phases.
CREATE TABLE IF NOT EXISTS public.call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  outcome TEXT CHECK (outcome IN ('success', 'failed', 'network_error', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_call ON public.call_sessions(call_id);

-- 3. Row Level Security (RLS)
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

-- Calls: Participants can read calls they are part of
DROP POLICY IF EXISTS "Participants can view their calls" ON public.calls;
CREATE POLICY "Participants can view their calls"
  ON public.calls
  FOR SELECT
  TO authenticated
  USING (initiator_id = auth.uid() OR recipient_id = auth.uid());

-- Call Sessions: Participants can view technical sessions of their calls
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

-- Direct mutations on calls/sessions are revoked; mutations proceed through security-definer RPCs
REVOKE ALL ON public.calls FROM PUBLIC, anon;
GRANT SELECT ON public.calls TO authenticated;

REVOKE ALL ON public.call_sessions FROM PUBLIC, anon;
GRANT SELECT ON public.call_sessions TO authenticated;

-- 4. Automatic Lifecycle Triggers

-- 4.1 Connection Deleted Trigger (Unfriend)
-- If a connection is terminated, any pending call between the two users is automatically cancelled.
CREATE OR REPLACE FUNCTION public.handle_connection_deleted_for_calls()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.calls c_call
  SET
    status = 'cancelled',
    outcome = 'unfriended',
    updated_at = now()
  FROM public.conversations conv
  WHERE c_call.conversation_id = conv.id
    AND c_call.status = 'pending'
    AND ((conv.user_a_id = OLD.user_a_id AND conv.user_b_id = OLD.user_b_id)
      OR (conv.user_a_id = OLD.user_b_id AND conv.user_b_id = OLD.user_a_id));

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_connection_deleted_calls ON public.connections;
CREATE TRIGGER trg_connection_deleted_calls
  AFTER DELETE ON public.connections
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_connection_deleted_for_calls();

-- 4.2 Block Created Trigger (Safety Action)
-- If a user blocks another user, all pending calls between them are cancelled with outcome = 'blocked'.
CREATE OR REPLACE FUNCTION public.handle_block_created_for_calls()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.calls c_call
  SET
    status = 'cancelled',
    outcome = 'blocked',
    updated_at = now()
  FROM public.conversations conv
  WHERE c_call.conversation_id = conv.id
    AND c_call.status = 'pending'
    AND ((conv.user_a_id = NEW.blocker_id AND conv.user_b_id = NEW.blocked_id)
      OR (conv.user_a_id = NEW.blocked_id AND conv.user_b_id = NEW.blocker_id));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_created_calls ON public.blocks;
CREATE TRIGGER trg_block_created_calls
  AFTER INSERT ON public.blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_block_created_for_calls();

-- 5. Business Logic RPCs for Phase 1

-- 5.1 Create Immediate Call Request
-- Responsibilities:
-- 1. Authenticate caller
-- 2. Verify conversation membership and resolve recipient
-- 3. Verify confirmed connection exists between the two
-- 4. Verify neither participant is blocked
-- 5. Require meaningful reason (preset, custom, or both)
-- 6. Require mode = 'immediate' (Phase 1 restriction)
-- 7. Clean up any stale expired pending call in this conversation
-- 8. Calculate request expiration using provisional default (e.g. 120s / 2m)
-- 9. Insert pending call
-- 10. Return structured call record
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
  v_expiration_seconds INT;
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
  v_expiration_seconds := 120;
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

-- 5.2 Respond to Call Request (Accept or Decline)
-- Recipient action with row-level locking for race-safety
CREATE OR REPLACE FUNCTION public.respond_to_call(
  p_call_id UUID,
  p_response TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_call RECORD;
  v_clean_response TEXT;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_clean_response := lower(trim(COALESCE(p_response, '')));
  IF v_clean_response NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION 'Invalid response action: Must be "accept" or "decline".';
  END IF;

  -- 1. Row-lock call record to ensure atomic transition
  SELECT *
  INTO v_call
  FROM public.calls
  WHERE id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Call not found.';
  END IF;

  -- 2. Verify caller is the designated recipient
  IF v_call.recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized: Only the recipient can respond to this call request.';
  END IF;

  -- 3. Verify status is pending
  IF v_call.status <> 'pending' THEN
    RAISE EXCEPTION 'Call request is no longer pending (current status: %).', v_call.status;
  END IF;

  -- 4. Verify request has not expired
  IF v_call.request_expires_at <= now() THEN
    UPDATE public.calls
    SET status = 'expired', outcome = 'expired', updated_at = now()
    WHERE id = p_call_id;
    RAISE EXCEPTION 'Call request has expired.';
  END IF;

  -- 5. Verify relationship is still valid
  IF public.are_users_blocked(v_caller_id, v_call.initiator_id) THEN
    UPDATE public.calls
    SET status = 'cancelled', outcome = 'blocked', updated_at = now()
    WHERE id = p_call_id;
    RAISE EXCEPTION 'Cannot respond to call: relationship is blocked.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.connections
    WHERE user_a_id = LEAST(v_caller_id, v_call.initiator_id)
      AND user_b_id = GREATEST(v_caller_id, v_call.initiator_id)
  ) THEN
    UPDATE public.calls
    SET status = 'cancelled', outcome = 'unfriended', updated_at = now()
    WHERE id = p_call_id;
    RAISE EXCEPTION 'Cannot respond to call: connection no longer exists.';
  END IF;

  -- 6. Execute transition
  IF v_clean_response = 'accept' THEN
    UPDATE public.calls
    SET
      status = 'accepted',
      updated_at = now()
    WHERE id = p_call_id;
  ELSE
    UPDATE public.calls
    SET
      status = 'declined',
      outcome = 'declined',
      updated_at = now()
    WHERE id = p_call_id;
  END IF;

  -- 7. Return updated call
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
  WHERE c.id = p_call_id;

  RETURN v_result;
END;
$$;

-- 5.3 Cancel Call Request
-- Initiator cancels their pending request
CREATE OR REPLACE FUNCTION public.cancel_call(
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
  v_result JSONB;
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

  -- 2. Verify caller is initiator
  IF v_call.initiator_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized: Only the initiator can cancel this call request.';
  END IF;

  -- 3. Verify status is pending
  IF v_call.status <> 'pending' THEN
    RAISE EXCEPTION 'Call request cannot be cancelled because it is not pending (current status: %).', v_call.status;
  END IF;

  -- 4. Execute cancellation
  UPDATE public.calls
  SET
    status = 'cancelled',
    outcome = 'cancelled',
    updated_at = now()
  WHERE id = p_call_id;

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
  WHERE c.id = p_call_id;

  RETURN v_result;
END;
$$;

-- 5.4 Get Conversation Calls (With lazy expiration evaluation)
CREATE OR REPLACE FUNCTION public.get_conversation_calls(
  p_conversation_id UUID,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  conversation_id UUID,
  initiator_id UUID,
  recipient_id UUID,
  mode TEXT,
  preset_reason TEXT,
  custom_reason TEXT,
  request_expires_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  status TEXT,
  outcome TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
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
    RAISE EXCEPTION 'Not authorized to view calls in this conversation.';
  END IF;

  -- Lazy expiration cleanup
  UPDATE public.calls
  SET status = 'expired', outcome = 'expired', updated_at = now()
  WHERE conversation_id = p_conversation_id
    AND status = 'pending'
    AND request_expires_at <= now();

  RETURN QUERY
  SELECT 
    c.id,
    c.conversation_id,
    c.initiator_id,
    c.recipient_id,
    c.mode,
    c.preset_reason,
    c.custom_reason,
    c.request_expires_at,
    c.scheduled_at,
    c.status,
    c.outcome,
    c.started_at,
    c.ended_at,
    c.created_at,
    c.updated_at
  FROM public.calls c
  WHERE c.conversation_id = p_conversation_id
  ORDER BY c.created_at DESC
  LIMIT LEAST(p_limit, 50);
END;
$$;

-- 5.5 Get Active Call for Conversation
CREATE OR REPLACE FUNCTION public.get_active_call_for_conversation(
  p_conversation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_conv RECORD;
  v_result JSONB;
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
    RAISE EXCEPTION 'Not authorized to view calls in this conversation.';
  END IF;

  -- Lazy expiration check on pending call
  UPDATE public.calls
  SET status = 'expired', outcome = 'expired', updated_at = now()
  WHERE conversation_id = p_conversation_id
    AND status = 'pending'
    AND request_expires_at <= now();

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
  WHERE c.conversation_id = p_conversation_id
    AND c.status IN ('pending', 'accepted', 'connecting', 'connected')
  ORDER BY c.created_at DESC
  LIMIT 1;

  RETURN v_result;
END;
$$;

-- 6. Realtime Publication Integration
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping publication alteration: %', SQLERRM;
END;
$$;

-- 7. Grant Permissions to Authenticated Role
GRANT EXECUTE ON FUNCTION public.create_call_request(UUID, TEXT, TEXT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_call(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_call(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_calls(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_call_for_conversation(UUID) TO authenticated;
