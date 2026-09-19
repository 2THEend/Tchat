-- ==============================================================================
-- Migration: 20260918110000_groups_messaging_and_ephemeral_sync.sql
-- Stage 5: Group Messaging & Realtime Ephemeral Sync Foundation
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Extend media_assets with group_id for Group Media
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'group_id'
  ) THEN
    ALTER TABLE public.media_assets ADD COLUMN group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE;
  END IF;
END;
$$;

-- Ensure an asset belongs to either a conversation or a group, or is a standalone upload
ALTER TABLE public.media_assets DROP CONSTRAINT IF EXISTS chk_media_assets_target;
ALTER TABLE public.media_assets ADD CONSTRAINT chk_media_assets_target
  CHECK (
    (conversation_id IS NOT NULL AND group_id IS NULL)
    OR (group_id IS NOT NULL AND conversation_id IS NULL)
    OR (conversation_id IS NULL AND group_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_media_assets_group ON public.media_assets(group_id);

-- ------------------------------------------------------------------------------
-- 2. Create group_messages Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'media', 'system')),
  content TEXT NULL,
  media_asset_id UUID NULL REFERENCES public.media_assets(id) ON DELETE SET NULL,
  sequence_number BIGINT GENERATED ALWAYS AS IDENTITY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Text content constraint: 1 to 2000 characters
  CONSTRAINT chk_group_message_text CHECK (
    message_type <> 'text' OR (content IS NOT NULL AND char_length(trim(content)) >= 1 AND char_length(content) <= 2000)
  ),
  -- Media content constraint: requires media_asset_id or non-empty caption
  CONSTRAINT chk_group_message_media CHECK (
    message_type <> 'media' OR (media_asset_id IS NOT NULL OR (content IS NOT NULL AND char_length(trim(content)) >= 1))
  )
);

-- Backlink media_assets message_id if group_message
CREATE INDEX IF NOT EXISTS idx_group_messages_group_seq ON public.group_messages(group_id, sequence_number ASC);
CREATE INDEX IF NOT EXISTS idx_group_messages_sender ON public.group_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_created ON public.group_messages(group_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 3. Extend group_members with Read Marker Columns
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'group_members' AND column_name = 'last_read_message_id'
  ) THEN
    ALTER TABLE public.group_members 
      ADD COLUMN last_read_message_id UUID REFERENCES public.group_messages(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'group_members' AND column_name = 'last_read_at'
  ) THEN
    ALTER TABLE public.group_members 
      ADD COLUMN last_read_at TIMESTAMPTZ;
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Row Level Security Policies
-- ------------------------------------------------------------------------------

-- 4.1 group_messages RLS
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: Active group members can read messages as long as the group is active or in grace period
DROP POLICY IF EXISTS "Active group members can read messages" ON public.group_messages;
CREATE POLICY "Active group members can read messages"
  ON public.group_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      JOIN public.groups g ON g.id = gm.group_id
      WHERE gm.group_id = group_messages.group_id
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
        AND g.lifecycle_status IN ('active', 'read_only')
        AND g.grace_expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_bans gb
      WHERE gb.group_id = group_messages.group_id
        AND gb.user_id = auth.uid()
    )
  );

-- INSERT: Prevent direct client insert; all message posting must go through authoritative send_group_message RPC
DROP POLICY IF EXISTS "Direct client insert denied on group_messages" ON public.group_messages;
CREATE POLICY "Direct client insert denied on group_messages"
  ON public.group_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- UPDATE / DELETE: Prohibited for standard clients
DROP POLICY IF EXISTS "Direct client update denied on group_messages" ON public.group_messages;
CREATE POLICY "Direct client update denied on group_messages"
  ON public.group_messages
  FOR UPDATE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS "Direct client delete denied on group_messages" ON public.group_messages;
CREATE POLICY "Direct client delete denied on group_messages"
  ON public.group_messages
  FOR DELETE
  TO authenticated
  USING (false);

-- 4.2 Update media_assets RLS to include Group Media
DROP POLICY IF EXISTS "Participants can view media assets" ON public.media_assets;
CREATE POLICY "Participants can view media assets"
  ON public.media_assets
  FOR SELECT
  TO authenticated
  USING (
    uploader_id = auth.uid()
    OR (
      conversation_id IS NOT NULL AND conversation_id IN (
        SELECT c.id FROM public.conversations c
        WHERE (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
          AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
      )
    )
    OR (
      group_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.group_members gm
        JOIN public.groups g ON g.id = gm.group_id
        WHERE gm.group_id = media_assets.group_id
          AND gm.user_id = auth.uid()
          AND gm.status = 'active'
          AND g.lifecycle_status IN ('active', 'read_only')
          AND g.grace_expires_at > now()
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.group_bans gb
        WHERE gb.group_id = media_assets.group_id
          AND gb.user_id = auth.uid()
      )
    )
  );

-- 4.3 Update storage.objects RLS for Group Media
DROP POLICY IF EXISTS "Group members can upload group media" ON storage.objects;
CREATE POLICY "Group members can upload group media"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'conversation-media'
    AND (storage.foldername(name))[1] = 'groups'
    AND EXISTS (
      SELECT 1 FROM public.groups g
      JOIN public.group_members gm ON gm.group_id = g.id
      WHERE g.id::text = (storage.foldername(name))[2]
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
        AND g.lifecycle_status = 'active'
        AND g.expires_at > now()
    )
  );

DROP POLICY IF EXISTS "Group members can read unexpired group media" ON storage.objects;
CREATE POLICY "Group members can read unexpired group media"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'conversation-media'
    AND (storage.foldername(name))[1] = 'groups'
    AND EXISTS (
      SELECT 1 FROM public.groups g
      JOIN public.group_members gm ON gm.group_id = g.id
      JOIN public.media_assets ma ON ma.group_id = g.id
      WHERE g.id::text = (storage.foldername(name))[2]
        AND ma.storage_path = name
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
        AND g.lifecycle_status IN ('active', 'read_only')
        AND g.grace_expires_at > now()
        AND (ma.is_saved = true OR ma.expires_at > now())
    )
  );

-- ------------------------------------------------------------------------------
-- 5. Authoritative Group Messaging RPCs
-- ------------------------------------------------------------------------------

-- 5.1 create_group_media_asset RPC
-- Registers a validated media asset for a group with the standard 24-hour expiration.
CREATE OR REPLACE FUNCTION public.create_group_media_asset(
  p_group_id UUID,
  p_storage_path TEXT,
  p_media_type TEXT,
  p_mime_type TEXT DEFAULT NULL,
  p_file_size_bytes BIGINT DEFAULT NULL,
  p_original_filename TEXT DEFAULT NULL,
  p_allow_recipient_save BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_group RECORD;
  v_member RECORD;
  v_clean_filename TEXT;
  v_asset_id UUID;
  v_created_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Validate Group and Active Membership
  SELECT * INTO v_group
  FROM public.groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  IF v_group.lifecycle_status <> 'active' OR v_group.expires_at <= now() THEN
    RAISE EXCEPTION 'Group is not active or has expired';
  END IF;

  SELECT * INTO v_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized: You are not an active member of this group';
  END IF;

  -- 2. Verify not banned
  IF EXISTS (
    SELECT 1 FROM public.group_bans
    WHERE group_id = p_group_id AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'User is banned from this group';
  END IF;

  -- 3. Validate Media Type
  IF p_media_type NOT IN ('image', 'video', 'audio', 'file') THEN
    RAISE EXCEPTION 'Unsupported media type: %', p_media_type;
  END IF;

  -- 4. Validate File Size (Max 50MB, Positive)
  IF p_file_size_bytes IS NOT NULL AND (p_file_size_bytes <= 0 OR p_file_size_bytes > 52428800) THEN
    RAISE EXCEPTION 'File size out of allowed bounds (1B - 50MB)';
  END IF;

  -- 5. Authoritative 24-hour expiration
  v_created_at := now();
  v_expires_at := v_created_at + INTERVAL '24 hours';
  v_clean_filename := substring(trim(COALESCE(p_original_filename, 'attachment')) from 1 for 150);

  -- 6. Insert Media Asset Record
  INSERT INTO public.media_assets (
    group_id,
    uploader_id,
    storage_path,
    media_type,
    mime_type,
    file_size_bytes,
    original_filename,
    allow_recipient_save,
    is_saved,
    expires_at,
    created_at,
    updated_at
  )
  VALUES (
    p_group_id,
    v_caller_id,
    p_storage_path,
    p_media_type,
    p_mime_type,
    p_file_size_bytes,
    v_clean_filename,
    COALESCE(p_allow_recipient_save, true),
    false,
    v_expires_at,
    v_created_at,
    v_created_at
  )
  RETURNING id INTO v_asset_id;

  SELECT jsonb_build_object(
    'id', ma.id,
    'group_id', ma.group_id,
    'uploader_id', ma.uploader_id,
    'storage_path', ma.storage_path,
    'media_type', ma.media_type,
    'mime_type', ma.mime_type,
    'file_size_bytes', ma.file_size_bytes,
    'original_filename', ma.original_filename,
    'allow_recipient_save', ma.allow_recipient_save,
    'is_saved', ma.is_saved,
    'expires_at', ma.expires_at,
    'created_at', ma.created_at,
    'is_expired', false
  ) INTO v_result
  FROM public.media_assets ma
  WHERE ma.id = v_asset_id;

  RETURN v_result;
END;
$$;

-- 5.2 send_group_message RPC
-- Authoritatively checks membership, active lifecycle status, expiration, and inserts group message.
CREATE OR REPLACE FUNCTION public.send_group_message(
  p_group_id UUID,
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
  v_group RECORD;
  v_member RECORD;
  v_clean_content TEXT;
  v_msg_id UUID;
  v_seq BIGINT;
  v_created_at TIMESTAMPTZ;
  v_sender_profile RECORD;
  v_media RECORD;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Lock group row for concurrency and race-safe status & expiry evaluation
  SELECT g.* INTO v_group
  FROM public.groups g
  WHERE g.id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  -- 2. Verify group is active and unexpired
  IF v_group.lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'Group is not active (status: %)', v_group.lifecycle_status;
  END IF;

  IF v_group.expires_at <= now() THEN
    RAISE EXCEPTION 'Group has expired and cannot accept new messages';
  END IF;

  -- 3. Verify caller is an active group member
  SELECT * INTO v_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized: You are not an active member of this group';
  END IF;

  -- 4. Verify caller is not banned
  IF EXISTS (
    SELECT 1 FROM public.group_bans
    WHERE group_id = p_group_id AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'User is banned from this group';
  END IF;

  -- 5. Validate content & message type
  IF p_message_type = 'text' THEN
    v_clean_content := trim(p_content);
    IF v_clean_content IS NULL OR char_length(v_clean_content) < 1 THEN
      RAISE EXCEPTION 'Message content cannot be empty';
    END IF;
    IF char_length(p_content) > 2000 THEN
      RAISE EXCEPTION 'Message content exceeds maximum length of 2000 characters';
    END IF;
  ELSIF p_message_type = 'media' THEN
    IF p_media_asset_id IS NULL AND (p_content IS NULL OR trim(p_content) = '') THEN
      RAISE EXCEPTION 'Media message must have a media asset or content';
    END IF;
    v_clean_content := trim(COALESCE(p_content, ''));

    -- Verify media asset exists and belongs to this group
    IF p_media_asset_id IS NOT NULL THEN
      SELECT * INTO v_media
      FROM public.media_assets
      WHERE id = p_media_asset_id AND group_id = p_group_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Media asset not found or does not belong to this group';
      END IF;
    END IF;
  ELSIF p_message_type = 'system' THEN
    -- System messages can only be dispatched by group admin/mod
    IF v_member.role NOT IN ('admin', 'mod') THEN
      RAISE EXCEPTION 'Only group admins or moderators can send system messages';
    END IF;
    v_clean_content := trim(p_content);
    IF v_clean_content IS NULL OR char_length(v_clean_content) < 1 THEN
      RAISE EXCEPTION 'System message content cannot be empty';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported message type: %', p_message_type;
  END IF;

  -- 6. Insert group message
  INSERT INTO public.group_messages (
    group_id,
    sender_id,
    message_type,
    content,
    media_asset_id,
    created_at
  )
  VALUES (
    p_group_id,
    v_caller_id,
    p_message_type,
    v_clean_content,
    p_media_asset_id,
    now()
  )
  RETURNING id, sequence_number, created_at INTO v_msg_id, v_seq, v_created_at;

  -- 7. Automatically update sender's read marker to their newly sent message
  UPDATE public.group_members
  SET
    last_read_message_id = v_msg_id,
    last_read_at = v_created_at
  WHERE group_id = p_group_id AND user_id = v_caller_id AND status = 'active';

  -- Fetch sender profile
  SELECT id, username, display_name, avatar_url INTO v_sender_profile
  FROM public.profiles
  WHERE id = v_caller_id;

  -- Build response with safe left join to media_assets
  SELECT jsonb_build_object(
    'id', gm.id,
    'group_id', gm.group_id,
    'sender_id', gm.sender_id,
    'message_type', gm.message_type,
    'content', gm.content,
    'media_asset_id', gm.media_asset_id,
    'sequence_number', gm.sequence_number,
    'created_at', gm.created_at,
    'sender', jsonb_build_object(
      'id', v_sender_profile.id,
      'username', v_sender_profile.username,
      'display_name', v_sender_profile.display_name,
      'avatar_url', v_sender_profile.avatar_url,
      'role', v_member.role
    ),
    'media', CASE WHEN ma.id IS NOT NULL THEN jsonb_build_object(
      'id', ma.id,
      'storage_path', ma.storage_path,
      'media_type', ma.media_type,
      'mime_type', ma.mime_type,
      'file_size_bytes', ma.file_size_bytes,
      'original_filename', ma.original_filename,
      'allow_recipient_save', ma.allow_recipient_save,
      'is_saved', ma.is_saved,
      'expires_at', ma.expires_at,
      'is_expired', (ma.expires_at <= now() AND NOT ma.is_saved)
    ) ELSE NULL END
  ) INTO v_result
  FROM public.group_messages gm
  LEFT JOIN public.media_assets ma ON ma.id = gm.media_asset_id
  WHERE gm.id = v_msg_id;

  RETURN v_result;
END;
$$;

-- 5.3 get_group_messages RPC
-- Authoritatively fetches chronological messages with pagination and sender profiles.
CREATE OR REPLACE FUNCTION public.get_group_messages(
  p_group_id UUID,
  p_limit INT DEFAULT 50,
  p_before_seq BIGINT DEFAULT NULL,
  p_after_seq BIGINT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  group_id UUID,
  sender_id UUID,
  message_type TEXT,
  content TEXT,
  media_asset_id UUID,
  sequence_number BIGINT,
  created_at TIMESTAMPTZ,
  sender_username TEXT,
  sender_display_name TEXT,
  sender_avatar_url TEXT,
  sender_role TEXT,
  media JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_group RECORD;
  v_member RECORD;
  v_safe_limit INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Validate Group exists
  SELECT g.* INTO v_group
  FROM public.groups g
  WHERE g.id = p_group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  -- 2. Caller must be an active group member
  SELECT mem.* INTO v_member
  FROM public.group_members mem
  WHERE mem.group_id = p_group_id AND mem.user_id = v_caller_id AND mem.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized: Only active group members can read messages';
  END IF;

  -- 3. Check group ban
  IF EXISTS (
    SELECT 1 FROM public.group_bans gb
    WHERE gb.group_id = p_group_id AND gb.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'User is banned from this group';
  END IF;

  -- 4. Check group lifecycle status & grace period
  IF v_group.lifecycle_status NOT IN ('active', 'read_only') OR v_group.grace_expires_at <= now() THEN
    RAISE EXCEPTION 'Group is no longer accessible';
  END IF;

  v_safe_limit := LEAST(COALESCE(p_limit, 50), 100);

  RETURN QUERY
  SELECT
    gm.id,
    gm.group_id,
    gm.sender_id,
    gm.message_type,
    gm.content,
    gm.media_asset_id,
    gm.sequence_number,
    gm.created_at,
    p.username AS sender_username,
    p.display_name AS sender_display_name,
    p.avatar_url AS sender_avatar_url,
    COALESCE(mem.role, 'member') AS sender_role,
    CASE 
      WHEN ma.id IS NOT NULL THEN jsonb_build_object(
        'id', ma.id,
        'storage_path', ma.storage_path,
        'media_type', ma.media_type,
        'mime_type', ma.mime_type,
        'file_size_bytes', ma.file_size_bytes,
        'original_filename', ma.original_filename,
        'allow_recipient_save', ma.allow_recipient_save,
        'is_saved', ma.is_saved,
        'expires_at', ma.expires_at,
        'is_expired', (ma.expires_at <= now() AND NOT ma.is_saved)
      )
      ELSE NULL
    END AS media
  FROM public.group_messages gm
  LEFT JOIN public.profiles p ON p.id = gm.sender_id
  LEFT JOIN public.group_members mem ON (mem.group_id = gm.group_id AND mem.user_id = gm.sender_id AND mem.status = 'active')
  LEFT JOIN public.media_assets ma ON ma.id = gm.media_asset_id
  WHERE gm.group_id = p_group_id
    AND (p_before_seq IS NULL OR gm.sequence_number < p_before_seq)
    AND (p_after_seq IS NULL OR gm.sequence_number > p_after_seq)
  ORDER BY gm.sequence_number ASC
  LIMIT v_safe_limit;
END;
$$;

-- 5.4 mark_group_messages_read RPC
-- Atomically advances caller's read marker forward.
-- Invariants:
-- - Message must belong to the specified group
-- - Caller must be an active member
-- - Read marker cannot move backwards
-- - Only caller's marker is updated
CREATE OR REPLACE FUNCTION public.mark_group_messages_read(
  p_group_id UUID,
  p_message_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_member RECORD;
  v_target_msg RECORD;
  v_current_read_msg RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Validate caller is an active member
  SELECT * INTO v_caller_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized: You are not an active member of this group';
  END IF;

  -- 2. Validate target message exists and belongs to this group
  SELECT * INTO v_target_msg
  FROM public.group_messages
  WHERE id = p_message_id AND group_id = p_group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found in this group';
  END IF;

  -- 3. Check current read marker sequence; prevent backwards movement
  IF v_caller_member.last_read_message_id IS NOT NULL THEN
    SELECT * INTO v_current_read_msg
    FROM public.group_messages
    WHERE id = v_caller_member.last_read_message_id;

    IF FOUND AND v_target_msg.sequence_number < v_current_read_msg.sequence_number THEN
      -- Already read past this message; do not move marker backwards
      RETURN jsonb_build_object(
        'success', true,
        'group_id', p_group_id,
        'last_read_message_id', v_caller_member.last_read_message_id,
        'unchanged', true
      );
    END IF;
  END IF;

  -- 4. Advance read marker
  UPDATE public.group_members
  SET
    last_read_message_id = p_message_id,
    last_read_at = now()
  WHERE id = v_caller_member.id;

  RETURN jsonb_build_object(
    'success', true,
    'group_id', p_group_id,
    'last_read_message_id', p_message_id,
    'last_read_at', now()
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. Add group_messages to Supabase Realtime Publication
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
  END IF;
END;
$$;

ALTER TABLE public.group_messages REPLICA IDENTITY FULL;
