-- ==============================================================================
-- Tchat: Connections & Safety Blocks Domain Migration
-- Migration: 20260913010000_create_tchat_connections_and_blocks.sql
-- Description: Relational data model for intentional 1:1 connections, connection requests
--              with required context/reason, and access/safety blocks.
-- ==============================================================================

-- 1. Create Blocks Table (Safety & Access Restriction)
CREATE TABLE IF NOT EXISTS public.blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_not_self_block CHECK (blocker_id <> blocked_id),
  CONSTRAINT unique_block UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON public.blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON public.blocks(blocked_id);

-- 2. Create Connections Table (Bidirectional Human Relationship)
-- Note: Invariant user_a_id < user_b_id enforces canonical ordering to prevent duplicate
-- opposite-direction rows and race conditions.
CREATE TABLE IF NOT EXISTS public.connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_b_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_canonical_order CHECK (user_a_id < user_b_id),
  CONSTRAINT unique_canonical_connection UNIQUE (user_a_id, user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_connections_user_a ON public.connections(user_a_id);
CREATE INDEX IF NOT EXISTS idx_connections_user_b ON public.connections(user_b_id);

-- 3. Create Connection Requests Table (Intentional Permission Request with Context)
CREATE TABLE IF NOT EXISTS public.connection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  context TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'ignored', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_not_self_request CHECK (sender_id <> recipient_id),
  CONSTRAINT check_context_length CHECK (char_length(trim(context)) >= 3 AND char_length(context) <= 300)
);

CREATE INDEX IF NOT EXISTS idx_conn_req_sender ON public.connection_requests(sender_id);
CREATE INDEX IF NOT EXISTS idx_conn_req_recipient ON public.connection_requests(recipient_id);
CREATE INDEX IF NOT EXISTS idx_conn_req_status ON public.connection_requests(status);

-- Invariant: Only ONE pending request can exist between any pair of users at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_pending_connection_request 
  ON public.connection_requests (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id))
  WHERE status = 'pending';

-- 4. Enable Row Level Security
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connection_requests ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for Blocks
DROP POLICY IF EXISTS "Users can view own blocks" ON public.blocks;
CREATE POLICY "Users can view own blocks"
  ON public.blocks
  FOR SELECT
  TO authenticated
  USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own blocks" ON public.blocks;
CREATE POLICY "Users can insert own blocks"
  ON public.blocks
  FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = auth.uid() AND blocker_id <> blocked_id);

DROP POLICY IF EXISTS "Users can delete own blocks" ON public.blocks;
CREATE POLICY "Users can delete own blocks"
  ON public.blocks
  FOR DELETE
  TO authenticated
  USING (blocker_id = auth.uid());

-- 6. RLS Policies for Connections
DROP POLICY IF EXISTS "Users can view own connections" ON public.connections;
CREATE POLICY "Users can view own connections"
  ON public.connections
  FOR SELECT
  TO authenticated
  USING (user_a_id = auth.uid() OR user_b_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own connections" ON public.connections;
CREATE POLICY "Users can delete own connections"
  ON public.connections
  FOR DELETE
  TO authenticated
  USING (user_a_id = auth.uid() OR user_b_id = auth.uid());

-- 7. RLS Policies for Connection Requests
DROP POLICY IF EXISTS "Users can view requests involving themselves" ON public.connection_requests;
CREATE POLICY "Users can view requests involving themselves"
  ON public.connection_requests
  FOR SELECT
  TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own requests" ON public.connection_requests;
CREATE POLICY "Users can insert own requests"
  ON public.connection_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid() AND sender_id <> recipient_id);

DROP POLICY IF EXISTS "Recipients and senders can update their requests" ON public.connection_requests;
CREATE POLICY "Recipients and senders can update their requests"
  ON public.connection_requests
  FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid())
  WITH CHECK (sender_id = auth.uid() OR recipient_id = auth.uid());

-- 8. Business Logic RPCs (Enforcing Invariants & Authorization Server-Side)

-- 8.1 Search Profiles with Discovery Privacy & Block Filtering
CREATE OR REPLACE FUNCTION public.search_profiles(
  p_query TEXT,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  relationship_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_clean_query TEXT;
  v_norm_query TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_clean_query := trim(p_query);
  IF v_clean_query LIKE '@%' THEN
    v_clean_query := substring(v_clean_query FROM 2);
  END IF;
  v_norm_query := lower(trim(v_clean_query));

  IF v_norm_query = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    CASE 
      -- Existing Connection
      WHEN EXISTS (
        SELECT 1 FROM public.connections c
        WHERE (c.user_a_id = LEAST(v_caller_id, p.id) AND c.user_b_id = GREATEST(v_caller_id, p.id))
      ) THEN 'connected'
      -- Pending Request Sent by Caller
      WHEN EXISTS (
        SELECT 1 FROM public.connection_requests cr
        WHERE cr.sender_id = v_caller_id AND cr.recipient_id = p.id AND cr.status = 'pending'
      ) THEN 'request_sent'
      -- Pending Request Received from Target
      WHEN EXISTS (
        SELECT 1 FROM public.connection_requests cr
        WHERE cr.sender_id = p.id AND cr.recipient_id = v_caller_id AND cr.status = 'pending'
      ) THEN 'request_received'
      ELSE 'none'
    END AS relationship_status
  FROM public.profiles p
  JOIN public.accounts a ON a.id = p.id
  WHERE 
    -- Exclude caller themselves
    p.id <> v_caller_id
    -- Exclude suspended or deactivated accounts
    AND a.status = 'active'
    -- Exclude blocked users (either caller blocked target, or target blocked caller)
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = v_caller_id AND b.blocked_id = p.id)
         OR (b.blocker_id = p.id AND b.blocked_id = v_caller_id)
    )
    -- Match username prefix/contains or display name contains
    AND (
      p.normalized_username LIKE v_norm_query || '%'
      OR p.normalized_username LIKE '%' || v_norm_query || '%'
      OR (p.display_name IS NOT NULL AND p.display_name ILIKE '%' || v_clean_query || '%')
    )
  ORDER BY 
    CASE WHEN p.normalized_username = v_norm_query THEN 0
         WHEN p.normalized_username LIKE v_norm_query || '%' THEN 1
         ELSE 2 
    END,
    p.normalized_username ASC
  LIMIT LEAST(p_limit, 50);
END;
$$;

-- 8.2 Send Connection Request
CREATE OR REPLACE FUNCTION public.send_connection_request(
  p_recipient_id UUID,
  p_context TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sender_id UUID;
  v_sender_status TEXT;
  v_recipient_status TEXT;
  v_trimmed_context TEXT;
  v_recent_request_count INT;
  v_new_request_id UUID;
  v_result JSONB;
BEGIN
  v_sender_id := auth.uid();
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_sender_id = p_recipient_id THEN
    RAISE EXCEPTION 'Cannot send connection request to yourself.';
  END IF;

  v_trimmed_context := trim(p_context);
  IF v_trimmed_context IS NULL OR char_length(v_trimmed_context) < 3 THEN
    RAISE EXCEPTION 'A context or reason (minimum 3 characters) is required.';
  END IF;
  IF char_length(v_trimmed_context) > 300 THEN
    RAISE EXCEPTION 'Context cannot exceed 300 characters.';
  END IF;

  -- 1. Check account status of sender
  SELECT status INTO v_sender_status FROM public.accounts WHERE id = v_sender_id;
  IF v_sender_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Account is not in active status.';
  END IF;

  -- 2. Check account status of recipient
  SELECT status INTO v_recipient_status FROM public.accounts WHERE id = p_recipient_id;
  IF v_recipient_status IS NULL THEN
    RAISE EXCEPTION 'Recipient account does not exist.';
  END IF;
  IF v_recipient_status <> 'active' THEN
    RAISE EXCEPTION 'Recipient account is not active.';
  END IF;

  -- 3. Check blocks in either direction
  IF EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = v_sender_id AND blocked_id = p_recipient_id)
       OR (blocker_id = p_recipient_id AND blocked_id = v_sender_id)
  ) THEN
    RAISE EXCEPTION 'Unable to connect with this user.';
  END IF;

  -- 4. Check if already connected
  IF EXISTS (
    SELECT 1 FROM public.connections
    WHERE user_a_id = LEAST(v_sender_id, p_recipient_id)
      AND user_b_id = GREATEST(v_sender_id, p_recipient_id)
  ) THEN
    RAISE EXCEPTION 'You are already connected with this user.';
  END IF;

  -- 5. Check if active pending request exists in either direction
  IF EXISTS (
    SELECT 1 FROM public.connection_requests
    WHERE ((sender_id = v_sender_id AND recipient_id = p_recipient_id)
        OR (sender_id = p_recipient_id AND recipient_id = v_sender_id))
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A pending connection request already exists between you and this user.';
  END IF;

  -- 6. Rate Limit check: max 20 requests per hour
  SELECT count(*) INTO v_recent_request_count
  FROM public.connection_requests
  WHERE sender_id = v_sender_id
    AND created_at > (now() - interval '1 hour');

  IF v_recent_request_count >= 20 THEN
    RAISE EXCEPTION 'Request limit reached. Please wait before sending more connection requests.';
  END IF;

  -- 7. Insert new request
  INSERT INTO public.connection_requests (
    sender_id,
    recipient_id,
    context,
    status,
    created_at,
    updated_at
  )
  VALUES (
    v_sender_id,
    p_recipient_id,
    v_trimmed_context,
    'pending',
    now(),
    now()
  )
  RETURNING id INTO v_new_request_id;

  SELECT jsonb_build_object(
    'id', cr.id,
    'sender_id', cr.sender_id,
    'recipient_id', cr.recipient_id,
    'context', cr.context,
    'status', cr.status,
    'created_at', cr.created_at
  ) INTO v_result
  FROM public.connection_requests cr
  WHERE cr.id = v_new_request_id;

  RETURN v_result;
END;
$$;

-- 8.3 Accept Connection Request
CREATE OR REPLACE FUNCTION public.accept_connection_request(
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_req RECORD;
  v_user_low UUID;
  v_user_high UUID;
  v_conn_id UUID;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_req
  FROM public.connection_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Connection request not found.';
  END IF;

  IF v_req.recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'You are not authorized to accept this connection request.';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is no longer pending (current status: %).', v_req.status;
  END IF;

  -- Verify no blocks exist
  IF EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = v_caller_id AND blocked_id = v_req.sender_id)
       OR (blocker_id = v_req.sender_id AND blocked_id = v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Cannot accept connection request due to a block.';
  END IF;

  v_user_low := LEAST(v_req.sender_id, v_caller_id);
  v_user_high := GREATEST(v_req.sender_id, v_caller_id);

  -- Insert connection (idempotent ON CONFLICT)
  INSERT INTO public.connections (user_a_id, user_b_id, created_at, updated_at)
  VALUES (v_user_low, v_user_high, now(), now())
  ON CONFLICT (user_a_id, user_b_id) DO UPDATE
  SET updated_at = now()
  RETURNING id INTO v_conn_id;

  -- Update request status to accepted
  UPDATE public.connection_requests
  SET status = 'accepted', updated_at = now()
  WHERE id = p_request_id;

  SELECT jsonb_build_object(
    'id', c.id,
    'user_a_id', c.user_a_id,
    'user_b_id', c.user_b_id,
    'created_at', c.created_at
  ) INTO v_result
  FROM public.connections c
  WHERE c.id = v_conn_id;

  RETURN v_result;
END;
$$;

-- 8.4 Decline Connection Request
CREATE OR REPLACE FUNCTION public.decline_connection_request(
  p_request_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_recipient_id UUID;
  v_status TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT recipient_id, status INTO v_recipient_id, v_status
  FROM public.connection_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Connection request not found.';
  END IF;

  IF v_recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized to decline this request.';
  END IF;

  IF v_status <> 'pending' THEN
    RETURN FALSE;
  END IF;

  UPDATE public.connection_requests
  SET status = 'declined', updated_at = now()
  WHERE id = p_request_id;

  RETURN TRUE;
END;
$$;

-- 8.5 Ignore Connection Request
CREATE OR REPLACE FUNCTION public.ignore_connection_request(
  p_request_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_recipient_id UUID;
  v_status TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT recipient_id, status INTO v_recipient_id, v_status
  FROM public.connection_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Connection request not found.';
  END IF;

  IF v_recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized to ignore this request.';
  END IF;

  IF v_status <> 'pending' THEN
    RETURN FALSE;
  END IF;

  UPDATE public.connection_requests
  SET status = 'ignored', updated_at = now()
  WHERE id = p_request_id;

  RETURN TRUE;
END;
$$;

-- 8.6 Cancel Connection Request (Sender cancels)
CREATE OR REPLACE FUNCTION public.cancel_connection_request(
  p_request_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_sender_id UUID;
  v_status TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT sender_id, status INTO v_sender_id, v_status
  FROM public.connection_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Connection request not found.';
  END IF;

  IF v_sender_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized to cancel this request.';
  END IF;

  IF v_status <> 'pending' THEN
    RETURN FALSE;
  END IF;

  UPDATE public.connection_requests
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_request_id;

  RETURN TRUE;
END;
$$;

-- 8.7 Unfriend Connection
CREATE OR REPLACE FUNCTION public.unfriend_user(
  p_target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_low UUID;
  v_high UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_low := LEAST(v_caller_id, p_target_user_id);
  v_high := GREATEST(v_caller_id, p_target_user_id);

  DELETE FROM public.connections
  WHERE user_a_id = v_low AND user_b_id = v_high;

  RETURN TRUE;
END;
$$;

-- 8.8 Block User (Safety Action: terminates connection, cancels requests, records block)
CREATE OR REPLACE FUNCTION public.block_user(
  p_target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_caller_id = p_target_user_id THEN
    RAISE EXCEPTION 'Cannot block yourself.';
  END IF;

  -- 1. Insert block record
  INSERT INTO public.blocks (blocker_id, blocked_id, created_at)
  VALUES (v_caller_id, p_target_user_id, now())
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  -- 2. Terminate any active connection between the two
  DELETE FROM public.connections
  WHERE user_a_id = LEAST(v_caller_id, p_target_user_id)
    AND user_b_id = GREATEST(v_caller_id, p_target_user_id);

  -- 3. Cancel or decline any active pending connection requests
  UPDATE public.connection_requests
  SET status = 'declined', updated_at = now()
  WHERE ((sender_id = v_caller_id AND recipient_id = p_target_user_id)
      OR (sender_id = p_target_user_id AND recipient_id = v_caller_id))
    AND status = 'pending';

  RETURN TRUE;
END;
$$;

-- 8.9 Unblock User
CREATE OR REPLACE FUNCTION public.unblock_user(
  p_target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.blocks
  WHERE blocker_id = v_caller_id AND blocked_id = p_target_user_id;

  RETURN TRUE;
END;
$$;

-- 9. Permissions Lockdown for Authenticated Users
REVOKE ALL ON public.blocks FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.blocks TO authenticated;

REVOKE ALL ON public.connections FROM PUBLIC, anon;
GRANT SELECT, DELETE ON public.connections TO authenticated;

REVOKE ALL ON public.connection_requests FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.connection_requests TO authenticated;

GRANT EXECUTE ON FUNCTION public.search_profiles(TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_connection_request(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_connection_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_connection_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ignore_connection_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_connection_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unfriend_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_user(UUID) TO authenticated;
