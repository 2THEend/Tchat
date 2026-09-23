-- ==============================================================================
-- Migration: 20260918120000_fix_group_media_rls.sql
-- Description: Corrects RLS policies for Group Media on storage.objects and 
--              public.media_assets, and ensures authoritative save_media_asset RPC.
--
-- Root Cause:
-- 1. In storage.objects INSERT/SELECT policies, (storage.foldername(name))[2]
--    used unqualified 'name', which PostgreSQL shadowed to groups.name ('g.name')
--    inside the subquery. This evaluated to NULL and caused all group media uploads
--    to fail with "new row violates row-level security policy for table objects".
-- 2. In storage.objects SELECT policy, uploading clients using RETURNING required
--    either object ownership or an existing media_asset row, which is only registered
--    after storage upload finishes.
-- 3. In public.media_assets, INSERT and UPDATE policies were conversation-only and
--    did not validate group membership for group_id targets.
-- ==============================================================================

-- 1. Fix storage.objects INSERT policy for Group Media
DROP POLICY IF EXISTS "Group members can upload group media" ON storage.objects;
CREATE POLICY "Group members can upload group media"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'conversation-media'
    AND (storage.foldername(objects.name))[1] = 'groups'
    AND EXISTS (
      SELECT 1 FROM public.groups g
      JOIN public.group_members gm ON gm.group_id = g.id
      WHERE g.id::text = (storage.foldername(objects.name))[2]
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
        AND g.lifecycle_status = 'active'
        AND g.expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_bans gb
      WHERE gb.group_id::text = (storage.foldername(objects.name))[2]
        AND gb.user_id = auth.uid()
    )
  );

-- 2. Fix storage.objects SELECT policy for Group Media
DROP POLICY IF EXISTS "Group members can read unexpired group media" ON storage.objects;
CREATE POLICY "Group members can read unexpired group media"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'conversation-media'
    AND (storage.foldername(objects.name))[1] = 'groups'
    AND EXISTS (
      SELECT 1 FROM public.groups g
      JOIN public.group_members gm ON gm.group_id = g.id
      WHERE g.id::text = (storage.foldername(objects.name))[2]
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
        AND g.lifecycle_status IN ('active', 'read_only')
        AND g.grace_expires_at > now()
        AND (
          owner = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.media_assets ma
            WHERE ma.group_id = g.id
              AND ma.storage_path = objects.name
              AND (ma.is_saved = true OR ma.expires_at > now())
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_bans gb
      WHERE gb.group_id::text = (storage.foldername(objects.name))[2]
        AND gb.user_id = auth.uid()
    )
  );

-- 2.1 Fix storage.objects SELECT policy for 1:1 Media (to allow uploader during upload RETURNING)
DROP POLICY IF EXISTS "Participants can read unexpired conversation media" ON storage.objects;
CREATE POLICY "Participants can read unexpired conversation media"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'conversation-media'
    AND (
      owner = auth.uid()
      OR
      EXISTS (
        SELECT 1 FROM public.conversations c
        JOIN public.media_assets ma ON ma.conversation_id = c.id
        WHERE c.id::text = (storage.foldername(objects.name))[1]
          AND ma.storage_path = objects.name
          AND (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
          AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
          AND (ma.is_saved = true OR ma.expires_at > now())
      )
    )
  );

-- 3. Extend public.media_assets INSERT policy for both 1:1 and Group Media
DROP POLICY IF EXISTS "Participants can upload own media assets" ON public.media_assets;
CREATE POLICY "Participants can upload own media assets"
  ON public.media_assets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    uploader_id = auth.uid()
    AND (
      (
        conversation_id IS NOT NULL 
        AND group_id IS NULL
        AND conversation_id IN (
          SELECT c.id FROM public.conversations c
          WHERE (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
            AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
        )
      )
      OR
      (
        group_id IS NOT NULL 
        AND conversation_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.groups g
          JOIN public.group_members gm ON gm.group_id = g.id
          WHERE g.id = media_assets.group_id
            AND gm.user_id = auth.uid()
            AND gm.status = 'active'
            AND g.lifecycle_status = 'active'
            AND g.expires_at > now()
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.group_bans gb
          WHERE gb.group_id = media_assets.group_id
            AND gb.user_id = auth.uid()
        )
      )
    )
  );

-- 4. Extend public.media_assets UPDATE policy for both 1:1 and Group Media
DROP POLICY IF EXISTS "Participants can update media assets" ON public.media_assets;
CREATE POLICY "Participants can update media assets"
  ON public.media_assets
  FOR UPDATE
  TO authenticated
  USING (
    (
      conversation_id IS NOT NULL AND conversation_id IN (
        SELECT c.id FROM public.conversations c
        WHERE (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
          AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
      )
    )
    OR (
      group_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.groups g
        JOIN public.group_members gm ON gm.group_id = g.id
        WHERE g.id = media_assets.group_id
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
  )
  WITH CHECK (
    (
      conversation_id IS NOT NULL AND conversation_id IN (
        SELECT c.id FROM public.conversations c
        WHERE (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
          AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
      )
    )
    OR (
      group_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.groups g
        JOIN public.group_members gm ON gm.group_id = g.id
        WHERE g.id = media_assets.group_id
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

-- 5. Authoritative save_media_asset RPC with dual 1:1 and Group support
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

  -- 2. Authorization check based on target (Group vs 1:1 Conversation)
  IF v_asset.group_id IS NOT NULL THEN
    -- Must be active member of group and group within grace period
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members gm
      JOIN public.groups g ON g.id = gm.group_id
      WHERE gm.group_id = v_asset.group_id
        AND gm.user_id = v_caller_id
        AND gm.status = 'active'
        AND g.lifecycle_status IN ('active', 'read_only')
        AND g.grace_expires_at > now()
    ) OR EXISTS (
      SELECT 1 FROM public.group_bans gb
      WHERE gb.group_id = v_asset.group_id AND gb.user_id = v_caller_id
    ) THEN
      RAISE EXCEPTION 'Not authorized: You are not an active member of this group';
    END IF;
  ELSE
    -- 1:1 conversation check
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

    IF public.are_users_blocked(v_caller_id, v_other_id) THEN
      RAISE EXCEPTION 'Action blocked: User relationship is blocked.';
    END IF;
  END IF;

  -- 3. If already saved, return current state idempotently
  IF v_asset.is_saved THEN
    SELECT jsonb_build_object(
      'id', v_asset.id,
      'conversation_id', v_asset.conversation_id,
      'group_id', v_asset.group_id,
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

  -- 4. Check sender save restriction
  IF NOT v_asset.allow_recipient_save THEN
    RAISE EXCEPTION 'Sender has restricted saving for this media asset.';
  END IF;

  -- 5. Check if expired
  IF v_asset.expires_at <= now() THEN
    RAISE EXCEPTION 'Media asset has already expired and cannot be saved.';
  END IF;

  -- 6. Update to saved state
  UPDATE public.media_assets
  SET is_saved = true,
      saved_at = now(),
      saved_by_id = v_caller_id,
      updated_at = now()
  WHERE id = p_media_asset_id;

  SELECT jsonb_build_object(
    'id', ma.id,
    'conversation_id', ma.conversation_id,
    'group_id', ma.group_id,
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
