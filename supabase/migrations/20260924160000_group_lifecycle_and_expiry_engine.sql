-- ============================================================================
-- Migration: 20260924160000_group_lifecycle_and_expiry_engine.sql
-- Description: Group Phase 6.4: Database-Authoritative Group Lifecycle & Expiry Engine
--              Provides race-safe transition: active -> read_only -> deleted.
--              Evaluated authoritatively on access across all Group RPCs with
--              supplementary background cron sweep capabilities.
-- ============================================================================

-- Clean up any obsolete overloaded signatures to avoid ambiguity
DROP FUNCTION IF EXISTS public.leave_group(uuid);
DROP FUNCTION IF EXISTS public.remove_group_member(uuid, uuid);

-- ------------------------------------------------------------------------------
-- 1. Database-Authoritative Lifecycle Synchronization Functions
-- ------------------------------------------------------------------------------

-- Synchronizes a single group's lifecycle state based on database clock (now())
-- Concurrency and race-safe via row locking (FOR UPDATE).
CREATE OR REPLACE FUNCTION public.sync_group_lifecycle(p_group_id UUID)
RETURNS public.groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_group public.groups;
BEGIN
  IF p_group_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Row lock group for race-safe status evaluation
  SELECT * INTO v_group
  FROM public.groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 1. If at/past grace_expires_at, transition to 'deleted'
  IF now() >= v_group.grace_expires_at THEN
    IF v_group.lifecycle_status <> 'deleted' THEN
      UPDATE public.groups
      SET lifecycle_status = 'deleted', updated_at = now()
      WHERE id = p_group_id
      RETURNING * INTO v_group;
    END IF;

  -- 2. If at/past expires_at, transition to 'read_only'
  ELSIF now() >= v_group.expires_at THEN
    IF v_group.lifecycle_status = 'active' THEN
      UPDATE public.groups
      SET lifecycle_status = 'read_only', updated_at = now()
      WHERE id = p_group_id
      RETURNING * INTO v_group;
    END IF;
  END IF;

  RETURN v_group;
END;
$$;

-- Proactive batch sweep function for background jobs or list endpoints
-- Non-blocking via SKIP LOCKED.
CREATE OR REPLACE FUNCTION public.sweep_groups_lifecycle(p_limit INT DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_deleted_count INT := 0;
  v_readonly_count INT := 0;
  v_safe_limit INT;
BEGIN
  v_safe_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);

  -- 1. Sweep groups past grace_expires_at into deleted
  WITH to_delete AS (
    SELECT id
    FROM public.groups
    WHERE lifecycle_status IN ('active', 'read_only')
      AND now() >= grace_expires_at
    LIMIT v_safe_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.groups g
  SET lifecycle_status = 'deleted', updated_at = now()
  FROM to_delete
  WHERE g.id = to_delete.id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- 2. Sweep groups past expires_at into read_only
  WITH to_readonly AS (
    SELECT id
    FROM public.groups
    WHERE lifecycle_status = 'active'
      AND now() >= expires_at
      AND now() < grace_expires_at
    LIMIT v_safe_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.groups g
  SET lifecycle_status = 'read_only', updated_at = now()
  FROM to_readonly
  WHERE g.id = to_readonly.id;
  GET DIAGNOSTICS v_readonly_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'readonly_count', v_readonly_count,
    'sweep_at', now()
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. get_group_details RPC (with Lifecycle Synchronization)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_group_details(
  p_group_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_group public.groups;
  v_member_record RECORD;
  v_active_count INT;
  v_effective_mode TEXT;
  v_admin_profile RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Authoritatively evaluate and synchronize group lifecycle
  v_group := public.sync_group_lifecycle(p_group_id);

  -- Deleted/fully-expired groups are inaccessible
  IF v_group.id IS NULL OR v_group.lifecycle_status = 'deleted' THEN
    RAISE EXCEPTION 'Group not found or inaccessible';
  END IF;

  -- Ban check
  IF public.is_user_group_banned(p_group_id, v_caller_id) THEN
    RAISE EXCEPTION 'Group not found or inaccessible';
  END IF;

  -- Caller membership check
  SELECT * INTO v_member_record
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller_id;

  -- If private and caller is not active member, return not accessible
  IF v_group.visibility = 'private' AND (v_member_record.id IS NULL OR v_member_record.status <> 'active') THEN
    RAISE EXCEPTION 'Group not found or inaccessible';
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.group_members
  WHERE group_id = p_group_id AND status = 'active';

  v_effective_mode := public.get_group_effective_access_mode(p_group_id);

  -- Fetch Admin profile
  SELECT p.username, p.display_name, p.avatar_url INTO v_admin_profile
  FROM public.group_members gm
  JOIN public.profiles p ON p.id = gm.user_id
  WHERE gm.group_id = p_group_id AND gm.role = 'admin' AND gm.status = 'active'
  LIMIT 1;

  RETURN jsonb_build_object(
    'id', v_group.id,
    'name', v_group.name,
    'reason', v_group.reason,
    'cover_url', v_group.cover_url,
    'lifetime', v_group.lifetime,
    'expires_at', v_group.expires_at,
    'grace_expires_at', v_group.grace_expires_at,
    'visibility', v_group.visibility,
    'access_mode', v_group.access_mode,
    'effective_access_mode', v_effective_mode,
    'joining_question', v_group.joining_question,
    'max_size', v_group.max_size,
    'lifecycle_status', v_group.lifecycle_status,
    'member_count', v_active_count,
    'admin', jsonb_build_object(
      'username', v_admin_profile.username,
      'display_name', v_admin_profile.display_name,
      'avatar_url', v_admin_profile.avatar_url
    ),
    'membership', CASE 
      WHEN v_member_record.id IS NOT NULL THEN jsonb_build_object(
        'status', v_member_record.status,
        'role', v_member_record.role,
        'joined_at', v_member_record.joined_at
      )
      ELSE NULL
    END
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. send_group_message RPC (Authoritatively prevents messages after expires_at)
-- ------------------------------------------------------------------------------
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
  v_group public.groups;
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

  -- 1. Authoritatively evaluate and synchronize group lifecycle with row lock
  v_group := public.sync_group_lifecycle(p_group_id);

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  -- 2. Verify group is active and unexpired
  IF v_group.expires_at <= now() OR v_group.lifecycle_status = 'read_only' THEN
    RAISE EXCEPTION 'Group has expired and cannot accept new messages';
  END IF;

  IF v_group.lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'Group is not active (status: %)', v_group.lifecycle_status;
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
    SELECT 1 FROM public.group_bans gb
    WHERE gb.group_id = p_group_id AND gb.user_id = v_caller_id
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

      IF v_media.uploader_id <> v_caller_id THEN
        RAISE EXCEPTION 'You are not authorized to send this media asset';
      END IF;

      IF v_media.expires_at <= now() THEN
        RAISE EXCEPTION 'Media asset has expired and cannot be sent';
      END IF;
    END IF;
  ELSIF p_message_type = 'system' THEN
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
    'sender_username', v_sender_profile.username,
    'sender_display_name', v_sender_profile.display_name,
    'sender_avatar_url', v_sender_profile.avatar_url,
    'sender_role', v_member.role,
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

-- ------------------------------------------------------------------------------
-- 4. get_group_messages RPC (Allows reading during active and read_only grace)
-- ------------------------------------------------------------------------------
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
  v_group public.groups;
  v_member RECORD;
  v_safe_limit INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Validate Group exists and synchronize lifecycle
  v_group := public.sync_group_lifecycle(p_group_id);

  IF v_group.id IS NULL OR v_group.lifecycle_status = 'deleted' THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  -- 2. Caller must be an active group member
  SELECT mem.* INTO v_member
  FROM public.group_members mem
  WHERE mem.group_id = p_group_id AND mem.user_id = v_caller_id AND mem.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized: Only active group members can read messages';
  END IF;

  -- 3. Verify caller is not banned
  IF EXISTS (
    SELECT 1 FROM public.group_bans gb
    WHERE gb.group_id = p_group_id AND gb.user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'User is banned from this group';
  END IF;

  -- 4. Lifecycle accessibility: Allow reading during active and read_only grace period
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

-- ------------------------------------------------------------------------------
-- 5. create_group_media_asset RPC (Authoritative lifecycle check)
-- ------------------------------------------------------------------------------
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
  v_group public.groups;
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

  -- 1. Synchronize group lifecycle
  v_group := public.sync_group_lifecycle(p_group_id);

  IF v_group.id IS NULL OR v_group.lifecycle_status <> 'active' OR v_group.expires_at <= now() THEN
    RAISE EXCEPTION 'Group is not active or has expired';
  END IF;

  -- 2. Validate Membership
  SELECT * INTO v_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized: You are not an active member of this group';
  END IF;

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

-- ------------------------------------------------------------------------------
-- 6. join_group RPC (Exact original logic with authoritative lifecycle sync)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_group(
  p_group_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_group public.groups;
  v_active_count INT;
  v_effective_mode TEXT;
  v_existing_member RECORD;
  v_admin_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Synchronize group lifecycle and row lock
  v_group := public.sync_group_lifecycle(p_group_id);

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  IF v_group.lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'Group is not active (status: %)', v_group.lifecycle_status;
  END IF;

  IF now() >= v_group.expires_at THEN
    RAISE EXCEPTION 'Group has expired and cannot accept new members';
  END IF;

  -- Check group ban
  IF public.is_user_group_banned(p_group_id, v_caller_id) THEN
    RAISE EXCEPTION 'User is banned from this group';
  END IF;

  -- Check safety blocks with group creator/admin
  SELECT user_id INTO v_admin_id
  FROM public.group_members
  WHERE group_id = p_group_id AND role = 'admin' AND status = 'active'
  LIMIT 1;

  IF v_admin_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.blocks b
    WHERE (b.blocker_id = v_caller_id AND b.blocked_id = v_admin_id)
       OR (b.blocker_id = v_admin_id AND b.blocked_id = v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Cannot join this group due to user safety blocks';
  END IF;

  -- Check existing membership
  SELECT * INTO v_existing_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller_id;

  IF FOUND THEN
    IF v_existing_member.status = 'active' THEN
      RAISE EXCEPTION 'User is already an active member of this group';
    ELSIF v_existing_member.status = 'removed' THEN
      RAISE EXCEPTION 'User was removed from group and cannot rejoin through normal path';
    END IF;
  END IF;

  -- Check capacity under lock
  SELECT count(*) INTO v_active_count
  FROM public.group_members
  WHERE group_id = p_group_id AND status = 'active';

  IF v_active_count >= v_group.max_size THEN
    RAISE EXCEPTION 'Group has reached maximum capacity';
  END IF;

  -- Check dynamic effective access mode under lock
  v_effective_mode := public.get_group_effective_access_mode(p_group_id);
  IF v_effective_mode <> 'open' THEN
    RAISE EXCEPTION 'Group effective access requires a join request';
  END IF;

  -- Join group: If previous left row exists, update it to active and reset role to 'member'
  IF FOUND AND v_existing_member.status = 'left' THEN
    UPDATE public.group_members
    SET
      status = 'active',
      role = 'member',
      joined_at = now(),
      left_at = NULL,
      removed_at = NULL,
      removed_by_id = NULL
    WHERE id = v_existing_member.id;
  ELSE
    INSERT INTO public.group_members (
      group_id,
      user_id,
      role,
      status,
      joined_at
    ) VALUES (
      p_group_id,
      v_caller_id,
      'member',
      'active',
      now()
    );
  END IF;

  -- Auto-resolve any outstanding join request if present
  UPDATE public.group_join_requests
  SET status = 'approved', reviewed_at = now()
  WHERE group_id = p_group_id AND user_id = v_caller_id AND status = 'pending';

  RETURN jsonb_build_object(
    'group_id', p_group_id,
    'user_id', v_caller_id,
    'role', 'member',
    'status', 'active',
    'member_count', v_active_count + 1
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. request_to_join_group RPC (Exact original logic with lifecycle sync)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_to_join_group(
  p_group_id UUID,
  p_question_answer TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_group public.groups;
  v_existing_member RECORD;
  v_existing_request RECORD;
  v_request_id UUID;
  v_admin_id UUID;
  v_clean_answer TEXT;
  v_active_count INTEGER;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Synchronize group lifecycle
  v_group := public.sync_group_lifecycle(p_group_id);

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  IF v_group.lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'Group is no longer active';
  END IF;

  IF now() >= v_group.expires_at THEN
    RAISE EXCEPTION 'Group has expired';
  END IF;

  -- Check capacity
  SELECT count(*) INTO v_active_count
  FROM public.group_members
  WHERE group_id = p_group_id AND status = 'active';

  IF v_active_count >= v_group.max_size THEN
    RAISE EXCEPTION 'Group has reached maximum capacity';
  END IF;

  -- Check group ban
  IF public.is_user_group_banned(p_group_id, v_caller_id) THEN
    RAISE EXCEPTION 'User is banned from this group';
  END IF;

  -- Check safety blocks with admin
  SELECT user_id INTO v_admin_id
  FROM public.group_members
  WHERE group_id = p_group_id AND role = 'admin' AND status = 'active'
  LIMIT 1;

  IF v_admin_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.blocks b
    WHERE (b.blocker_id = v_caller_id AND b.blocked_id = v_admin_id)
       OR (b.blocker_id = v_admin_id AND b.blocked_id = v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Cannot request to join this group due to user safety blocks';
  END IF;

  -- Check existing membership
  SELECT * INTO v_existing_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller_id;

  IF FOUND THEN
    IF v_existing_member.status = 'active' THEN
      RAISE EXCEPTION 'User is already an active member of this group';
    ELSIF v_existing_member.status = 'removed' THEN
      RAISE EXCEPTION 'User was removed from group and cannot request to join';
    END IF;
  END IF;

  -- Check existing pending request
  SELECT * INTO v_existing_request
  FROM public.group_join_requests
  WHERE group_id = p_group_id AND user_id = v_caller_id AND status = 'pending';

  IF FOUND THEN
    RAISE EXCEPTION 'A join request is already pending for this group';
  END IF;

  -- Question validation if group is configured in question mode
  IF v_group.access_mode = 'question' THEN
    v_clean_answer := trim(p_question_answer);
    IF v_clean_answer IS NULL OR char_length(v_clean_answer) < 2 OR char_length(v_clean_answer) > 500 THEN
      RAISE EXCEPTION 'An answer between 2 and 500 characters is required to request to join';
    END IF;
  ELSE
    v_clean_answer := NULLIF(trim(p_question_answer), '');
  END IF;

  INSERT INTO public.group_join_requests (
    group_id,
    user_id,
    question_answer,
    status
  ) VALUES (
    p_group_id,
    v_caller_id,
    v_clean_answer,
    'pending'
  ) RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'group_id', p_group_id,
    'status', 'pending'
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. approve_group_join_request RPC (Exact original logic with lifecycle sync)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_group_join_request(
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_request RECORD;
  v_group public.groups;
  v_active_count INT;
  v_existing_member RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Lock request
  SELECT * INTO v_request
  FROM public.group_join_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Join request is no longer pending (current status: %)', v_request.status;
  END IF;

  -- Verify caller authorization
  v_caller_role := public.get_group_member_role(v_request.group_id, v_caller_id);
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'mod') THEN
    RAISE EXCEPTION 'Only group admins or moderators can approve join requests';
  END IF;

  -- Row lock group for capacity check & sync lifecycle
  v_group := public.sync_group_lifecycle(v_request.group_id);

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  IF v_group.lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'Group is no longer active';
  END IF;

  IF now() >= v_group.expires_at THEN
    RAISE EXCEPTION 'Group has expired and cannot accept new members';
  END IF;

  -- Check if target user is banned
  IF public.is_user_group_banned(v_request.group_id, v_request.user_id) THEN
    UPDATE public.group_join_requests
    SET status = 'declined', reviewed_by_id = v_caller_id, reviewed_at = now()
    WHERE id = p_request_id;
    RAISE EXCEPTION 'Cannot approve request: user is banned from this group';
  END IF;

  -- Check capacity
  SELECT count(*) INTO v_active_count
  FROM public.group_members
  WHERE group_id = v_request.group_id AND status = 'active';

  IF v_active_count >= v_group.max_size THEN
    RAISE EXCEPTION 'Group has reached maximum capacity';
  END IF;

  -- Insert or restore member as 'member' (never restores previous role)
  SELECT * INTO v_existing_member
  FROM public.group_members
  WHERE group_id = v_request.group_id AND user_id = v_request.user_id;

  IF FOUND THEN
    IF v_existing_member.status = 'active' THEN
      UPDATE public.group_join_requests
      SET status = 'approved', reviewed_by_id = v_caller_id, reviewed_at = now()
      WHERE id = p_request_id;
      RETURN jsonb_build_object('success', true, 'message', 'User already active');
    END IF;

    UPDATE public.group_members
    SET
      status = 'active',
      role = 'member',
      joined_at = now(),
      left_at = NULL,
      removed_at = NULL,
      removed_by_id = NULL
    WHERE id = v_existing_member.id;
  ELSE
    INSERT INTO public.group_members (
      group_id,
      user_id,
      role,
      status,
      joined_at
    ) VALUES (
      v_request.group_id,
      v_request.user_id,
      'member',
      'active',
      now()
    );
  END IF;

  -- Mark request approved
  UPDATE public.group_join_requests
  SET status = 'approved', reviewed_by_id = v_caller_id, reviewed_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'user_id', v_request.user_id,
    'group_id', v_request.group_id,
    'role', 'member',
    'status', 'active'
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. list_group_members RPC (Deleted group protection)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_group_members(UUID);
CREATE OR REPLACE FUNCTION public.list_group_members(
  p_group_id UUID
)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT,
  status TEXT,
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_group public.groups;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Synchronize group lifecycle
  v_group := public.sync_group_lifecycle(p_group_id);

  IF v_group.id IS NULL OR v_group.lifecycle_status = 'deleted' THEN
    RAISE EXCEPTION 'Group not found or inaccessible';
  END IF;

  -- Caller must be active member
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = v_caller_id AND gm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only active group members can view the member list';
  END IF;

  RETURN QUERY
  SELECT 
    gm.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    gm.role,
    gm.status,
    gm.joined_at
  FROM public.group_members gm
  JOIN public.profiles p ON p.id = gm.user_id
  WHERE gm.group_id = p_group_id AND gm.status = 'active'
  ORDER BY 
    CASE gm.role
      WHEN 'admin' THEN 1
      WHEN 'mod' THEN 2
      WHEN 'special' THEN 3
      ELSE 4
    END,
    gm.joined_at ASC;
END;
$$;


-- Restoring exact canonical operations from Phase 6.1/6.2/6.3
CREATE OR REPLACE FUNCTION public.assign_group_member_role(
  p_group_id UUID,
  p_target_user_id UUID,
  p_new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_target_member RECORD;
  v_mod_count INT;
  v_special_count INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Caller must be Admin
  v_caller_role := public.get_group_member_role(p_group_id, v_caller_id);
  IF v_caller_role IS NULL OR v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Only the group admin can assign member roles';
  END IF;

  IF p_target_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Admin cannot reassign their own role here; use transfer_group_admin';
  END IF;

  IF p_new_role NOT IN ('mod', 'special', 'member') THEN
    RAISE EXCEPTION 'Invalid role: %. Allowed: mod, special, member', p_new_role;
  END IF;

  -- Lock group to serialize role promotions
  PERFORM 1 FROM public.groups WHERE id = p_group_id FOR UPDATE;

  -- Find active target member
  SELECT * INTO v_target_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_target_user_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user is not an active member of this group';
  END IF;

  IF v_target_member.role = p_new_role THEN
    RETURN jsonb_build_object('success', true, 'role', p_new_role);
  END IF;

  -- Check role capacity limits
  IF p_new_role = 'mod' THEN
    SELECT count(*) INTO v_mod_count
    FROM public.group_members
    WHERE group_id = p_group_id AND role = 'mod' AND status = 'active' AND user_id <> p_target_user_id;

    IF v_mod_count >= 1 THEN
      RAISE EXCEPTION 'Group already has a moderator (maximum 1 allowed)';
    END IF;
  ELSIF p_new_role = 'special' THEN
    SELECT count(*) INTO v_special_count
    FROM public.group_members
    WHERE group_id = p_group_id AND role = 'special' AND status = 'active' AND user_id <> p_target_user_id;

    IF v_special_count >= 5 THEN
      RAISE EXCEPTION 'Group has reached maximum number of special members (maximum 5 allowed)';
    END IF;
  END IF;

  UPDATE public.group_members
  SET role = p_new_role
  WHERE id = v_target_member.id;

  RETURN jsonb_build_object(
    'success', true,
    'group_id', p_group_id,
    'user_id', p_target_user_id,
    'new_role', p_new_role
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_group_admin(
  p_group_id UUID,
  p_successor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_successor_member RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_successor_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot transfer admin to yourself';
  END IF;

  -- Lock group row
  PERFORM 1 FROM public.groups WHERE id = p_group_id FOR UPDATE;

  -- Caller must be current Admin
  v_caller_role := public.get_group_member_role(p_group_id, v_caller_id);
  IF v_caller_role IS NULL OR v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Only the current group admin can transfer admin';
  END IF;

  -- Successor must be an active member of this group
  SELECT * INTO v_successor_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_successor_user_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Successor is not an active member of this group';
  END IF;

  -- Atomic transfer: demote current admin to member, promote successor to admin
  -- (Trigger check is deferred until commit, ensuring exactly 1 admin)
  UPDATE public.group_members
  SET role = 'member'
  WHERE group_id = p_group_id AND user_id = v_caller_id AND status = 'active';

  UPDATE public.group_members
  SET role = 'admin'
  WHERE id = v_successor_member.id;

  RETURN jsonb_build_object(
    'success', true,
    'group_id', p_group_id,
    'old_admin_id', v_caller_id,
    'new_admin_id', p_successor_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_group_member(
  p_group_id UUID,
  p_target_user_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_target_role TEXT;
  v_target_member RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot remove yourself; use leave_group instead';
  END IF;

  -- Lock group
  PERFORM 1 FROM public.groups WHERE id = p_group_id FOR UPDATE;

  v_caller_role := public.get_group_member_role(p_group_id, v_caller_id);
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'mod') THEN
    RAISE EXCEPTION 'Only admins or mods can remove group members';
  END IF;

  SELECT * INTO v_target_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_target_user_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user is not an active member of this group';
  END IF;

  v_target_role := v_target_member.role;

  -- Admin cannot be removed
  IF v_target_role = 'admin' THEN
    RAISE EXCEPTION 'The group admin cannot be removed';
  END IF;

  -- Mod cannot remove another Mod
  IF v_caller_role = 'mod' AND v_target_role = 'mod' THEN
    RAISE EXCEPTION 'A moderator cannot remove another moderator';
  END IF;

  -- Atomically set status to removed and strip role to member
  UPDATE public.group_members
  SET
    status = 'removed',
    role = 'member',
    removed_at = now(),
    removed_by_id = v_caller_id
  WHERE id = v_target_member.id;

  RETURN jsonb_build_object(
    'success', true,
    'group_id', p_group_id,
    'user_id', p_target_user_id,
    'removed_by_id', v_caller_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ban_group_member(
  p_group_id UUID,
  p_target_user_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_target_member RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot ban yourself';
  END IF;

  -- Lock group
  PERFORM 1 FROM public.groups WHERE id = p_group_id FOR UPDATE;

  v_caller_role := public.get_group_member_role(p_group_id, v_caller_id);
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'mod') THEN
    RAISE EXCEPTION 'Only admins or mods can ban users from the group';
  END IF;

  -- Check if target is a member
  SELECT * INTO v_target_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_target_user_id AND status = 'active'
  FOR UPDATE;

  IF FOUND THEN
    IF v_target_member.role = 'admin' THEN
      RAISE EXCEPTION 'The group admin cannot be banned';
    END IF;

    IF v_caller_role = 'mod' AND v_target_member.role = 'mod' THEN
      RAISE EXCEPTION 'A moderator cannot ban another moderator';
    END IF;

    -- Remove active membership
    UPDATE public.group_members
    SET
      status = 'removed',
      role = 'member',
      removed_at = now(),
      removed_by_id = v_caller_id
    WHERE id = v_target_member.id;
  END IF;

  -- Insert ban record
  INSERT INTO public.group_bans (
    group_id,
    user_id,
    banned_by_id,
    reason
  ) VALUES (
    p_group_id,
    p_target_user_id,
    v_caller_id,
    p_reason
  )
  ON CONFLICT (group_id, user_id) DO UPDATE
  SET
    banned_by_id = EXCLUDED.banned_by_id,
    reason = EXCLUDED.reason,
    created_at = now();

  -- Cancel any pending join requests from banned user
  UPDATE public.group_join_requests
  SET status = 'declined', reviewed_by_id = v_caller_id, reviewed_at = now()
  WHERE group_id = p_group_id AND user_id = p_target_user_id AND status = 'pending';

  RETURN jsonb_build_object(
    'success', true,
    'group_id', p_group_id,
    'user_id', p_target_user_id,
    'banned_by_id', v_caller_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unban_group_member(
  p_group_id UUID,
  p_target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_caller_role := public.get_group_member_role(p_group_id, v_caller_id);
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'mod') THEN
    RAISE EXCEPTION 'Only admins or mods can unban users';
  END IF;

  DELETE FROM public.group_bans
  WHERE group_id = p_group_id AND user_id = p_target_user_id;

  RETURN jsonb_build_object('success', true, 'group_id', p_group_id, 'user_id', p_target_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_group(
  p_group_id UUID,
  p_successor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_member RECORD;
  v_active_count INT;
  v_successor_member RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Lock group
  PERFORM 1 FROM public.groups WHERE id = p_group_id FOR UPDATE;

  SELECT * INTO v_caller_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User is not an active member of this group';
  END IF;

  -- Total active members
  SELECT count(*) INTO v_active_count
  FROM public.group_members
  WHERE group_id = p_group_id AND status = 'active';

  -- Case A: Caller is regular member, special, or mod
  IF v_caller_member.role <> 'admin' THEN
    UPDATE public.group_members
    SET
      status = 'left',
      role = 'member',
      left_at = now()
    WHERE id = v_caller_member.id;

    RETURN jsonb_build_object(
      'success', true,
      'group_id', p_group_id,
      'status', 'left',
      'remaining_members', v_active_count - 1
    );
  END IF;

  -- Case B: Caller IS Admin
  IF v_active_count = 1 THEN
    -- Sole member leaves: Group transitions to deleted so active-admin invariant remains intact!
    UPDATE public.group_members
    SET
      status = 'left',
      role = 'member',
      left_at = now()
    WHERE id = v_caller_member.id;

    UPDATE public.groups
    SET lifecycle_status = 'deleted'
    WHERE id = p_group_id;

    RETURN jsonb_build_object(
      'success', true,
      'group_id', p_group_id,
      'status', 'left',
      'group_status', 'deleted',
      'remaining_members', 0
    );
  ELSE
    -- Multiple active members: Admin MUST designate a valid successor
    IF p_successor_user_id IS NULL OR p_successor_user_id = v_caller_id THEN
      RAISE EXCEPTION 'Group admin cannot leave without designating an active member as successor';
    END IF;

    SELECT * INTO v_successor_member
    FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_successor_user_id AND status = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Designated successor is not an active member of this group';
    END IF;

    -- Atomic succession and departure (depart old admin first to satisfy unique active admin index)
    UPDATE public.group_members
    SET
      status = 'left',
      role = 'member',
      left_at = now()
    WHERE id = v_caller_member.id;

    UPDATE public.group_members
    SET role = 'admin'
    WHERE id = v_successor_member.id;

    RETURN jsonb_build_object(
      'success', true,
      'group_id', p_group_id,
      'status', 'left',
      'new_admin_id', p_successor_user_id,
      'remaining_members', v_active_count - 1
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_group_join_requests(
  p_group_id UUID
)
RETURNS TABLE (
  request_id UUID,
  user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  question_answer TEXT,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_caller_role := public.get_group_member_role(p_group_id, v_caller_id);
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'mod') THEN
    RAISE EXCEPTION 'Only admins or mods can view join requests';
  END IF;

  RETURN QUERY
  SELECT
    gjr.id AS request_id,
    gjr.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    gjr.question_answer,
    gjr.status,
    gjr.created_at
  FROM public.group_join_requests gjr
  JOIN public.profiles p ON p.id = gjr.user_id
  WHERE gjr.group_id = p_group_id AND gjr.status = 'pending'
  ORDER BY gjr.created_at ASC;
END;
$$;

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

