-- ==============================================================================
-- Tchat: Ephemeral Media Domain Migration
-- Migration: 20260914030000_create_tchat_media_assets.sql
-- Description: Ephemeral Media foundation with 24-hour authoritative lifecycle,
--              recipient saving persistence, sender-controlled save restrictions,
--              storage bucket configuration, RLS policies, and RPC functions.
-- ==============================================================================

-- 1. Create Private Supabase Storage Bucket for Conversation Media
-- Private bucket: public = false ensures no unauthenticated or public URL access.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'conversation-media',
  'conversation-media',
  false,
  52428800, -- 50MB maximum upload limit
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav',
    'application/pdf', 'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav',
    'application/pdf', 'text/plain'
  ];

-- 2. Ensure media_assets Table with Full Ephemeral Lifecycle Columns
-- If media_assets already exists from previous migration, add the missing columns safely.
CREATE TABLE IF NOT EXISTS public.media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video', 'audio', 'file')),
  mime_type TEXT,
  file_size_bytes BIGINT,
  is_ephemeral BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safely alter columns for existing tables
DO $$
BEGIN
  -- Expand media_type constraint to include 'file'
  ALTER TABLE public.media_assets DROP CONSTRAINT IF EXISTS media_assets_media_type_check;
  ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_media_type_check 
    CHECK (media_type IN ('image', 'video', 'audio', 'file'));

  -- conversation_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'conversation_id'
  ) THEN
    ALTER TABLE public.media_assets ADD COLUMN conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE;
  END IF;

  -- message_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'message_id'
  ) THEN
    ALTER TABLE public.media_assets ADD COLUMN message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;
  END IF;

  -- original_filename
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'original_filename'
  ) THEN
    ALTER TABLE public.media_assets ADD COLUMN original_filename TEXT;
  END IF;

  -- allow_recipient_save (sender-controlled save restriction, default true)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'allow_recipient_save'
  ) THEN
    ALTER TABLE public.media_assets ADD COLUMN allow_recipient_save BOOLEAN NOT NULL DEFAULT true;
  END IF;

  -- is_saved (recipient explicit save persistence flag)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'is_saved'
  ) THEN
    ALTER TABLE public.media_assets ADD COLUMN is_saved BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- saved_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'saved_at'
  ) THEN
    ALTER TABLE public.media_assets ADD COLUMN saved_at TIMESTAMPTZ;
  END IF;

  -- saved_by_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'saved_by_id'
  ) THEN
    ALTER TABLE public.media_assets ADD COLUMN saved_by_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;

  -- viewed_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'viewed_at'
  ) THEN
    ALTER TABLE public.media_assets ADD COLUMN viewed_at TIMESTAMPTZ;
  END IF;

  -- updated_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.media_assets ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END;
$$;

-- 3. Indexes for High-Performance Queries
CREATE INDEX IF NOT EXISTS idx_media_assets_conversation ON public.media_assets(conversation_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_message ON public.media_assets(message_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_storage_path ON public.media_assets(storage_path);
CREATE INDEX IF NOT EXISTS idx_media_assets_expiry ON public.media_assets(expires_at, is_saved);

-- 4. Media Assets Row Level Security (RLS)
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

-- SELECT: Only conversation participants who are not blocked can view media assets
DROP POLICY IF EXISTS "Participants can view media assets" ON public.media_assets;
DROP POLICY IF EXISTS "Users can view media assets in their conversations" ON public.media_assets;
CREATE POLICY "Participants can view media assets"
  ON public.media_assets
  FOR SELECT
  TO authenticated
  USING (
    uploader_id = auth.uid()
    OR conversation_id IN (
      SELECT c.id FROM public.conversations c
      WHERE (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
        AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
    )
  );

-- INSERT: Only authenticated uploader who is an unblocked participant in the conversation
DROP POLICY IF EXISTS "Participants can upload own media assets" ON public.media_assets;
DROP POLICY IF EXISTS "Users can upload own media assets" ON public.media_assets;
CREATE POLICY "Participants can upload own media assets"
  ON public.media_assets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    uploader_id = auth.uid()
    AND (
      conversation_id IS NULL 
      OR conversation_id IN (
        SELECT c.id FROM public.conversations c
        WHERE (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
          AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
      )
    )
  );

-- UPDATE: Participants can update saved state if saving is allowed
DROP POLICY IF EXISTS "Participants can update media assets" ON public.media_assets;
CREATE POLICY "Participants can update media assets"
  ON public.media_assets
  FOR UPDATE
  TO authenticated
  USING (
    conversation_id IN (
      SELECT c.id FROM public.conversations c
      WHERE (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
        AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
    )
  )
  WITH CHECK (
    conversation_id IN (
      SELECT c.id FROM public.conversations c
      WHERE (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
        AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
    )
  );

-- 5. Storage Objects Row Level Security (RLS)
-- Controls direct access to storage bucket 'conversation-media'
-- Enforces:
-- 1. Conversation membership
-- 2. Non-blocked state
-- 3. Ephemeral expiration check (expired unsaved files CANNOT be downloaded)
DROP POLICY IF EXISTS "Participants can upload conversation media" ON storage.objects;
CREATE POLICY "Participants can upload conversation media"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'conversation-media'
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
        AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
    )
  );

DROP POLICY IF EXISTS "Participants can read unexpired conversation media" ON storage.objects;
CREATE POLICY "Participants can read unexpired conversation media"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'conversation-media'
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.media_assets ma ON ma.conversation_id = c.id
      WHERE c.id::text = (storage.foldername(name))[1]
        AND ma.storage_path = name
        AND (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
        AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
        -- Authoritative Server-side Expiration Check:
        -- Media is only downloadable if it has been saved OR expiration time is in the future
        AND (ma.is_saved = true OR ma.expires_at > now())
    )
  );

-- 6. Ephemeral Media Business Logic RPCs

-- 6.1 Authoritative Create Media Asset RPC
-- Registers a validated media asset prior to or during message transmission.
-- Enforces 24-hour lifetime from creation: expires_at = now() + 24 hours.
CREATE OR REPLACE FUNCTION public.create_media_asset(
  p_conversation_id UUID,
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
  v_conv RECORD;
  v_other_id UUID;
  v_clean_filename TEXT;
  v_asset_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_created_at TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Validate Conversation and Membership
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

  v_other_id := CASE WHEN v_conv.user_a_id = v_caller_id THEN v_conv.user_b_id ELSE v_conv.user_a_id END;

  -- 2. Verify No Block
  IF public.are_users_blocked(v_caller_id, v_other_id) THEN
    RAISE EXCEPTION 'Cannot create media asset: user is blocked.';
  END IF;

  -- 3. Verify Active Connection
  IF NOT EXISTS (
    SELECT 1 FROM public.connections
    WHERE user_a_id = LEAST(v_caller_id, v_other_id) AND user_b_id = GREATEST(v_caller_id, v_other_id)
  ) THEN
    RAISE EXCEPTION 'Cannot create media asset: connection is no longer active.';
  END IF;

  -- 4. Validate Media Type
  IF p_media_type NOT IN ('image', 'video', 'audio', 'file') THEN
    RAISE EXCEPTION 'Unsupported media type: %', p_media_type;
  END IF;

  -- 5. Validate File Size (Max 50MB, Positive)
  IF p_file_size_bytes IS NOT NULL AND (p_file_size_bytes <= 0 OR p_file_size_bytes > 52428800) THEN
    RAISE EXCEPTION 'File size out of allowed bounds (1B - 50MB).';
  END IF;

  -- 6. Authoritative Expiration Calculation: sent_at + 24 hours
  v_created_at := now();
  v_expires_at := v_created_at + INTERVAL '24 hours';
  v_clean_filename := substring(trim(COALESCE(p_original_filename, 'attachment')) from 1 for 150);

  -- 7. Insert Media Asset Record
  INSERT INTO public.media_assets (
    conversation_id,
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
    p_conversation_id,
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
    'conversation_id', ma.conversation_id,
    'uploader_id', ma.uploader_id,
    'storage_path', ma.storage_path,
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
    'is_expired', false
  ) INTO v_result
  FROM public.media_assets ma
  WHERE ma.id = v_asset_id;

  RETURN v_result;
END;
$$;

-- 6.2 Authoritative Save Media Asset RPC
-- Allows the recipient to intentionally persist an ephemeral media asset.
-- Enforces:
-- 1. Conversation membership
-- 2. Sender restriction: allow_recipient_save = true
-- 3. Non-expired state (cannot save once expired)
CREATE OR REPLACE FUNCTION public.save_media_asset(
  p_media_asset_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_asset RECORD;
  v_conv RECORD;
  v_other_id UUID;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Fetch Media Asset
  SELECT * INTO v_asset
  FROM public.media_assets
  WHERE id = p_media_asset_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Media asset not found.';
  END IF;

  -- 2. Fetch Associated Conversation
  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = v_asset.conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated conversation not found.';
  END IF;

  IF v_conv.user_a_id <> v_caller_id AND v_conv.user_b_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized: You are not a participant in this conversation.';
  END IF;

  v_other_id := CASE WHEN v_conv.user_a_id = v_caller_id THEN v_conv.user_b_id ELSE v_conv.user_a_id END;

  -- 3. Block Check
  IF public.are_users_blocked(v_caller_id, v_other_id) THEN
    RAISE EXCEPTION 'Action blocked: User relationship is blocked.';
  END IF;

  -- 4. Check If Already Saved
  IF v_asset.is_saved THEN
    SELECT jsonb_build_object(
      'id', v_asset.id,
      'conversation_id', v_asset.conversation_id,
      'uploader_id', v_asset.uploader_id,
      'storage_path', v_asset.storage_path,
      'media_type', v_asset.media_type,
      'mime_type', v_asset.mime_type,
      'file_size_bytes', v_asset.file_size_bytes,
      'original_filename', v_asset.original_filename,
      'allow_recipient_save', v_asset.allow_recipient_save,
      'is_saved', true,
      'saved_at', v_asset.saved_at,
      'saved_by_id', v_asset.saved_by_id,
      'expires_at', v_asset.expires_at,
      'created_at', v_asset.created_at,
      'is_expired', false
    ) INTO v_result;
    RETURN v_result;
  END IF;

  -- 5. Enforce Sender-Controlled Save Restriction
  IF NOT v_asset.allow_recipient_save THEN
    RAISE EXCEPTION 'Sender has restricted saving for this media asset.';
  END IF;

  -- 6. Enforce Authoritative Expiration (cannot save expired asset)
  IF v_asset.expires_at <= now() THEN
    RAISE EXCEPTION 'Media asset has already expired and cannot be saved.';
  END IF;

  -- 7. Apply Persistence
  UPDATE public.media_assets
  SET
    is_saved = true,
    saved_at = now(),
    saved_by_id = v_caller_id,
    updated_at = now()
  WHERE id = p_media_asset_id;

  SELECT jsonb_build_object(
    'id', ma.id,
    'conversation_id', ma.conversation_id,
    'uploader_id', ma.uploader_id,
    'storage_path', ma.storage_path,
    'media_type', ma.media_type,
    'mime_type', ma.mime_type,
    'file_size_bytes', ma.file_size_bytes,
    'original_filename', ma.original_filename,
    'allow_recipient_save', ma.allow_recipient_save,
    'is_saved', true,
    'saved_at', ma.saved_at,
    'saved_by_id', ma.saved_by_id,
    'expires_at', ma.expires_at,
    'created_at', ma.created_at,
    'is_expired', false
  ) INTO v_result
  FROM public.media_assets ma
  WHERE ma.id = p_media_asset_id;

  RETURN v_result;
END;
$$;

-- 6.3 Authoritative Get Media Access RPC
-- Validates viewing permissions, updates viewed timestamp without resetting expiration,
-- and determines server-authoritative expiration status.
CREATE OR REPLACE FUNCTION public.get_media_access(
  p_media_asset_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_asset RECORD;
  v_conv RECORD;
  v_other_id UUID;
  v_is_expired BOOLEAN;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_asset
  FROM public.media_assets
  WHERE id = p_media_asset_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Media asset not found.';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = v_asset.conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found.';
  END IF;

  IF v_conv.user_a_id <> v_caller_id AND v_conv.user_b_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not authorized to access media in this conversation.';
  END IF;

  v_other_id := CASE WHEN v_conv.user_a_id = v_caller_id THEN v_conv.user_b_id ELSE v_conv.user_a_id END;

  IF public.are_users_blocked(v_caller_id, v_other_id) THEN
    RAISE EXCEPTION 'Access denied due to block.';
  END IF;

  -- Authoritative Expiration Status
  v_is_expired := (v_asset.expires_at <= now() AND NOT v_asset.is_saved);

  -- If expired and not saved: do not leak storage path
  IF v_is_expired THEN
    RETURN jsonb_build_object(
      'id', v_asset.id,
      'media_type', v_asset.media_type,
      'is_expired', true,
      'is_saved', false,
      'expires_at', v_asset.expires_at,
      'storage_path', NULL
    );
  END IF;

  -- Update viewed_at if caller is recipient and not previously viewed
  -- Crucial: viewing does NOT reset or change expires_at!
  IF v_caller_id <> v_asset.uploader_id AND v_asset.viewed_at IS NULL THEN
    UPDATE public.media_assets
    SET viewed_at = now()
    WHERE id = p_media_asset_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_asset.id,
    'conversation_id', v_asset.conversation_id,
    'uploader_id', v_asset.uploader_id,
    'storage_path', v_asset.storage_path,
    'media_type', v_asset.media_type,
    'mime_type', v_asset.mime_type,
    'file_size_bytes', v_asset.file_size_bytes,
    'original_filename', v_asset.original_filename,
    'allow_recipient_save', v_asset.allow_recipient_save,
    'is_saved', v_asset.is_saved,
    'saved_at', v_asset.saved_at,
    'saved_by_id', v_asset.saved_by_id,
    'expires_at', v_asset.expires_at,
    'created_at', v_asset.created_at,
    'is_expired', false
  );
END;
$$;

-- 6.4 Upgrade Authoritative Send Message RPC
-- Seamlessly links media assets to message records and records activity type 'media'.
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
  v_media_record RECORD;
  v_media_preview TEXT;
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

  -- 8. Return complete message object with media asset details
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
    ) ELSE NULL END
  ) INTO v_result
  FROM public.messages m
  LEFT JOIN public.media_assets ma ON ma.id = m.media_asset_id
  WHERE m.id = v_msg_id;

  RETURN v_result;
END;
$$;

-- 6.5 Upgrade Authoritative Get Conversation Messages RPC
-- Returns messages joined with full media metadata and authoritative is_expired calculation.
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
  created_at TIMESTAMPTZ,
  media JSONB
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

  v_other_id := CASE WHEN v_conv.user_a_id = v_caller_id THEN v_conv.user_b_id ELSE v_conv.user_a_id END;

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
    m.created_at,
    CASE WHEN ma.id IS NOT NULL THEN jsonb_build_object(
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
    ) ELSE NULL END AS media
  FROM public.messages m
  LEFT JOIN public.media_assets ma ON ma.id = m.media_asset_id
  WHERE m.conversation_id = p_conversation_id
    AND (p_before_seq IS NULL OR m.sequence_number < p_before_seq)
  ORDER BY m.sequence_number ASC
  LIMIT LEAST(p_limit, 100);
END;
$$;

-- 7. Permissions Grants
REVOKE ALL ON public.media_assets FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.media_assets TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_media_asset(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_media_asset(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_media_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_message(UUID, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_messages(UUID, INT, BIGINT) TO authenticated;

-- 8. Add media_assets to Realtime Publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'media_assets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.media_assets;
  END IF;
END;
$$;

ALTER TABLE public.media_assets REPLICA IDENTITY FULL;
