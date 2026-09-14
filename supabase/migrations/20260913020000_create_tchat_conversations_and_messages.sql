-- ==============================================================================
-- Tchat: Conversations & Messaging Domain Migration
-- Migration: 20260913020000_create_tchat_conversations_and_messages.sql
-- Description: Persistent 1:1 conversations between confirmed connections,
--              server-authoritative chronological messages, participant state,
--              ephemeral media foundation, Realtime publication, and RLS.
-- ==============================================================================

-- 1. Media Assets Foundation Table
-- Minimal safe schema for future ephemeral media assets.
CREATE TABLE IF NOT EXISTS public.media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video', 'audio')),
  mime_type TEXT,
  file_size_bytes BIGINT,
  is_ephemeral BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_uploader ON public.media_assets(uploader_id);

-- 2. Conversations Table (Persistent 1:1 Conversation per Connected Pair)
-- Invariant: user_a_id < user_b_id enforces canonical ordering to guarantee exactly
-- ONE ongoing 1:1 conversation between any connected pair.
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES public.connections(id) ON DELETE SET NULL,
  user_a_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_b_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  last_activity_at TIMESTAMPTZ,
  last_activity_type TEXT CHECK (last_activity_type IN ('text', 'media', 'call')),
  last_message_preview TEXT,
  last_sender_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_canonical_conversation_order CHECK (user_a_id < user_b_id),
  CONSTRAINT unique_canonical_conversation UNIQUE (user_a_id, user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_a ON public.conversations(user_a_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_b ON public.conversations(user_b_id);
CREATE INDEX IF NOT EXISTS idx_conversations_connection ON public.conversations(connection_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_activity ON public.conversations(last_activity_at DESC NULLS LAST);

-- 3. Conversation Participants Table
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at TIMESTAMPTZ,
  last_read_message_id UUID,

  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON public.conversation_participants(user_id);

-- 4. Messages Table
-- Uses server-authoritative IDENTITY sequence_number for deterministic chronological ordering
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'media')),
  content TEXT,
  media_asset_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL,
  sequence_number BIGINT GENERATED ALWAYS AS IDENTITY,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_text_content CHECK (message_type <> 'text' OR (content IS NOT NULL AND char_length(trim(content)) >= 1 AND char_length(content) <= 2000)),
  CONSTRAINT check_media_content CHECK (message_type <> 'media' OR media_asset_id IS NOT NULL OR content IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq ON public.messages(conversation_id, sequence_number ASC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON public.messages(conversation_id, status) WHERE status <> 'read';

-- 5. Helper Function: Bidirectional Block Check
CREATE OR REPLACE FUNCTION public.are_users_blocked(p_user_a UUID, p_user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = p_user_a AND blocked_id = p_user_b)
       OR (blocker_id = p_user_b AND blocked_id = p_user_a)
  );
$$;

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies

-- Conversations RLS
DROP POLICY IF EXISTS "Participants can view their conversations" ON public.conversations;
CREATE POLICY "Participants can view their conversations"
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (
    (user_a_id = auth.uid() OR user_b_id = auth.uid())
    AND NOT public.are_users_blocked(user_a_id, user_b_id)
  );

-- Conversation Participants RLS
DROP POLICY IF EXISTS "Participants can view conversation participants" ON public.conversation_participants;
CREATE POLICY "Participants can view conversation participants"
  ON public.conversation_participants
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR conversation_id IN (
      SELECT id FROM public.conversations
      WHERE user_a_id = auth.uid() OR user_b_id = auth.uid()
    )
  );

-- Messages RLS
DROP POLICY IF EXISTS "Participants can view messages" ON public.messages;
CREATE POLICY "Participants can view messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
        AND NOT public.are_users_blocked(user_a_id, user_b_id)
    )
  );

DROP POLICY IF EXISTS "Participants can insert own messages" ON public.messages;
CREATE POLICY "Participants can insert own messages"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND conversation_id IN (
      SELECT c.id FROM public.conversations c
      JOIN public.connections conn ON (
        conn.user_a_id = c.user_a_id AND conn.user_b_id = c.user_b_id
      )
      WHERE (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
        AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
    )
  );

DROP POLICY IF EXISTS "Recipients can update message status" ON public.messages;
CREATE POLICY "Recipients can update message status"
  ON public.messages
  FOR UPDATE
  TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
    )
    AND sender_id <> auth.uid()
  )
  WITH CHECK (
    status IN ('delivered', 'read')
  );

-- Media Assets RLS
DROP POLICY IF EXISTS "Users can view media assets in their conversations" ON public.media_assets;
CREATE POLICY "Users can view media assets in their conversations"
  ON public.media_assets
  FOR SELECT
  TO authenticated
  USING (
    uploader_id = auth.uid()
    OR id IN (
      SELECT m.media_asset_id FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      WHERE (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
        AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
    )
  );

DROP POLICY IF EXISTS "Users can upload own media assets" ON public.media_assets;
CREATE POLICY "Users can upload own media assets"
  ON public.media_assets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    uploader_id = auth.uid()
  );

-- 8. Business Logic RPCs

-- 8.1 Extend Accept Connection Request to Atomically Provision 1:1 Conversation
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
  v_conv_id UUID;
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
  IF public.are_users_blocked(v_caller_id, v_req.sender_id) THEN
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

  -- Ensure 1:1 persistent conversation exists without creating Home activity (last_activity_at is NULL initially)
  INSERT INTO public.conversations (connection_id, user_a_id, user_b_id, created_at, updated_at, last_activity_at)
  VALUES (v_conn_id, v_user_low, v_user_high, now(), now(), NULL)
  ON CONFLICT (user_a_id, user_b_id) DO UPDATE
  SET connection_id = v_conn_id, updated_at = now()
  RETURNING id INTO v_conv_id;

  -- Ensure conversation participants exist
  INSERT INTO public.conversation_participants (conversation_id, user_id, joined_at)
  VALUES (v_conv_id, v_user_low, now()),
         (v_conv_id, v_user_high, now())
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  -- Update request status to accepted
  UPDATE public.connection_requests
  SET status = 'accepted', updated_at = now()
  WHERE id = p_request_id;

  SELECT jsonb_build_object(
    'id', c.id,
    'user_a_id', c.user_a_id,
    'user_b_id', c.user_b_id,
    'conversation_id', v_conv_id,
    'created_at', c.created_at
  ) INTO v_result
  FROM public.connections c
  WHERE c.id = v_conn_id;

  RETURN v_result;
END;
$$;

-- 8.2 Get or Create 1:1 Conversation for Connected User
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(
  p_other_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_low UUID;
  v_high UUID;
  v_conn_id UUID;
  v_conv_id UUID;
  v_conv RECORD;
  v_other_profile RECORD;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_other_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot converse with yourself';
  END IF;

  IF public.are_users_blocked(v_caller_id, p_other_user_id) THEN
    RAISE EXCEPTION 'Cannot open conversation due to block.';
  END IF;

  v_low := LEAST(v_caller_id, p_other_user_id);
  v_high := GREATEST(v_caller_id, p_other_user_id);

  -- Verify active connection
  SELECT id INTO v_conn_id
  FROM public.connections
  WHERE user_a_id = v_low AND user_b_id = v_high;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A confirmed connection is required to open a conversation.';
  END IF;

  -- Ensure 1:1 conversation exists
  INSERT INTO public.conversations (connection_id, user_a_id, user_b_id, created_at, updated_at, last_activity_at)
  VALUES (v_conn_id, v_low, v_high, now(), now(), NULL)
  ON CONFLICT (user_a_id, user_b_id) DO UPDATE
  SET connection_id = COALESCE(public.conversations.connection_id, EXCLUDED.connection_id)
  RETURNING id INTO v_conv_id;

  -- Ensure participants exist
  INSERT INTO public.conversation_participants (conversation_id, user_id, joined_at)
  VALUES (v_conv_id, v_low, now()), (v_conv_id, v_high, now())
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  -- Fetch conversation record
  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = v_conv_id;

  -- Fetch partner profile
  SELECT id, username, display_name, avatar_url, bio
  INTO v_other_profile
  FROM public.profiles
  WHERE id = p_other_user_id;

  SELECT jsonb_build_object(
    'id', v_conv.id,
    'connection_id', v_conv.connection_id,
    'user_a_id', v_conv.user_a_id,
    'user_b_id', v_conv.user_b_id,
    'last_activity_at', v_conv.last_activity_at,
    'last_activity_type', v_conv.last_activity_type,
    'last_message_preview', v_conv.last_message_preview,
    'last_sender_id', v_conv.last_sender_id,
    'created_at', v_conv.created_at,
    'updated_at', v_conv.updated_at,
    'other_participant', jsonb_build_object(
      'id', v_other_profile.id,
      'username', v_other_profile.username,
      'display_name', v_other_profile.display_name,
      'avatar_url', v_other_profile.avatar_url,
      'bio', v_other_profile.bio
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 8.3 Authoritative Send Message RPC
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id UUID,
  p_content TEXT,
  p_message_type TEXT DEFAULT 'text',
  p_media_asset_id UUID DEFAULT NULL
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

  -- Determine other participant
  IF v_conv.user_a_id = v_caller_id THEN
    v_other_id := v_conv.user_b_id;
  ELSE
    v_other_id := v_conv.user_a_id;
  END IF;

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

  -- 4. Validate content & message type
  IF p_message_type = 'text' THEN
    v_clean_content := trim(p_content);
    IF v_clean_content IS NULL OR char_length(v_clean_content) < 1 THEN
      RAISE EXCEPTION 'Message content cannot be empty.';
    END IF;
    IF char_length(p_content) > 2000 THEN
      RAISE EXCEPTION 'Message content exceeds maximum length of 2000 characters.';
    END IF;
  ELSIF p_message_type = 'media' THEN
    IF p_media_asset_id IS NULL AND (p_content IS NULL OR trim(p_content) = '') THEN
      RAISE EXCEPTION 'Media message must have a media asset or content.';
    END IF;
    v_clean_content := trim(COALESCE(p_content, ''));
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

  -- 6. Update conversation activity (meaningful social communication)
  UPDATE public.conversations
  SET 
    last_activity_at = v_created_at,
    last_activity_type = p_message_type,
    last_message_preview = substring(v_clean_content from 1 for 100),
    last_sender_id = v_caller_id,
    updated_at = v_created_at
  WHERE id = p_conversation_id;

  -- Return message object
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
    'created_at', m.created_at
  ) INTO v_result
  FROM public.messages m
  WHERE m.id = v_msg_id;

  RETURN v_result;
END;
$$;

-- 8.4 Mark Conversation Read RPC
CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  p_conversation_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_count INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify caller is a participant in conversation
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = p_conversation_id AND (user_a_id = v_caller_id OR user_b_id = v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to access this conversation';
  END IF;

  -- Update messages sent by the OTHER participant to 'read'
  WITH updated AS (
    UPDATE public.messages
    SET status = 'read', read_at = now()
    WHERE conversation_id = p_conversation_id
      AND sender_id <> v_caller_id
      AND status <> 'read'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;

  -- Update participant last_read_at
  UPDATE public.conversation_participants
  SET last_read_at = now()
  WHERE conversation_id = p_conversation_id AND user_id = v_caller_id;

  RETURN v_count;
END;
$$;

-- 8.5 Get User's Conversations
CREATE OR REPLACE FUNCTION public.get_user_conversations()
RETURNS TABLE (
  id UUID,
  connection_id UUID,
  user_a_id UUID,
  user_b_id UUID,
  last_activity_at TIMESTAMPTZ,
  last_activity_type TEXT,
  last_message_preview TEXT,
  last_sender_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  unread_count BIGINT,
  other_id UUID,
  other_username TEXT,
  other_display_name TEXT,
  other_avatar_url TEXT
)
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

  RETURN QUERY
  SELECT 
    c.id,
    c.connection_id,
    c.user_a_id,
    c.user_b_id,
    c.last_activity_at,
    c.last_activity_type,
    c.last_message_preview,
    c.last_sender_id,
    c.created_at,
    c.updated_at,
    COALESCE(
      (SELECT count(*) FROM public.messages m 
       WHERE m.conversation_id = c.id 
         AND m.sender_id <> v_caller_id 
         AND m.status <> 'read'),
      0
    )::BIGINT AS unread_count,
    p.id AS other_id,
    p.username AS other_username,
    p.display_name AS other_display_name,
    p.avatar_url AS other_avatar_url
  FROM public.conversations c
  JOIN public.profiles p ON (
    p.id = CASE WHEN c.user_a_id = v_caller_id THEN c.user_b_id ELSE c.user_a_id END
  )
  WHERE (c.user_a_id = v_caller_id OR c.user_b_id = v_caller_id)
    AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
  ORDER BY c.last_activity_at DESC NULLS LAST, c.created_at DESC;
END;
$$;

-- 8.6 Get Authoritative Chronological Messages for Conversation
CREATE OR REPLACE FUNCTION public.get_conversation_messages(
  p_conversation_id UUID,
  p_limit INT DEFAULT 50,
  p_before_seq BIGINT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  conversation_id UUID,
  sender_id UUID,
  message_type TEXT,
  content TEXT,
  media_asset_id UUID,
  sequence_number BIGINT,
  status TEXT,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_conv RECORD;
  v_other_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT c.user_a_id, c.user_b_id INTO v_conv
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF v_conv.user_a_id <> v_caller_id AND v_conv.user_b_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized to access this conversation';
  END IF;

  IF v_conv.user_a_id = v_caller_id THEN
    v_other_id := v_conv.user_b_id;
  ELSE
    v_other_id := v_conv.user_a_id;
  END IF;

  IF public.are_users_blocked(v_caller_id, v_other_id) THEN
    RAISE EXCEPTION 'Access denied due to block';
  END IF;

  RETURN QUERY
  SELECT 
    m.id,
    m.conversation_id,
    m.sender_id,
    m.message_type,
    m.content,
    m.media_asset_id,
    m.sequence_number,
    m.status,
    m.delivered_at,
    m.read_at,
    m.created_at
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id
    AND (p_before_seq IS NULL OR m.sequence_number < p_before_seq)
  ORDER BY m.sequence_number ASC
  LIMIT LEAST(p_limit, 100);
END;
$$;

-- 9. Permissions Grants
REVOKE ALL ON public.media_assets FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.media_assets TO authenticated;

REVOKE ALL ON public.conversations FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;

REVOKE ALL ON public.conversation_participants FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.conversation_participants TO authenticated;

REVOKE ALL ON public.messages FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;

GRANT EXECUTE ON FUNCTION public.are_users_blocked(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_connection_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_message(UUID, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_messages(UUID, INT, BIGINT) TO authenticated;

-- 10. Realtime Setup
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END;
$$;

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;

-- 11. Idempotent Backfill for Existing Connections
INSERT INTO public.conversations (connection_id, user_a_id, user_b_id, created_at, updated_at, last_activity_at)
SELECT c.id, c.user_a_id, c.user_b_id, c.created_at, c.updated_at, NULL
FROM public.connections c
ON CONFLICT (user_a_id, user_b_id) DO UPDATE
SET connection_id = EXCLUDED.connection_id;

INSERT INTO public.conversation_participants (conversation_id, user_id, joined_at)
SELECT conv.id, conv.user_a_id, conv.created_at
FROM public.conversations conv
ON CONFLICT (conversation_id, user_id) DO NOTHING;

INSERT INTO public.conversation_participants (conversation_id, user_id, joined_at)
SELECT conv.id, conv.user_b_id, conv.created_at
FROM public.conversations conv
ON CONFLICT (conversation_id, user_id) DO NOTHING;
