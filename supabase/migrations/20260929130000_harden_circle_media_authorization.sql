-- Migration: 20260929130000_harden_circle_media_authorization.sql
-- Fixes Circle media authorization leak in RLS and save_media_asset RPC.

-- 1. Update public.media_assets SELECT policy for group media
-- Previously, "Participants can view media assets" allowed active group members to select any row
-- with group_id IS NOT NULL, which accidentally included circle media rows (since they set both group_id and circle_id).
-- We scope this to ensure group_id IS NOT NULL AND circle_id IS NULL.
-- Circle media rows (circle_id IS NOT NULL) are strictly protected by "Circle members can read unexpired circle media".

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
      group_id IS NOT NULL 
      AND circle_id IS NULL
      AND EXISTS (
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

-- 2. Update storage.objects SELECT policy for group and circle media
-- In "Group members can read unexpired group media", if the media asset is associated with a circle,
-- ensure the caller is an active member of that circle.

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
              AND (
                ma.circle_id IS NULL
                OR EXISTS (
                  SELECT 1 FROM public.circle_members cm
                  JOIN public.circles c ON c.id = cm.circle_id
                  WHERE cm.circle_id = ma.circle_id
                    AND cm.user_id = auth.uid()
                    AND cm.status = 'active'
                    AND c.lifecycle_status <> 'deleted'
                )
              )
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_bans gb
      WHERE gb.group_id::text = (storage.foldername(objects.name))[2]
        AND gb.user_id = auth.uid()
    )
  );

-- 3. Harden public.save_media_asset RPC for Circle Media
-- Enforces that if v_asset.circle_id IS NOT NULL, the caller must be an active circle member.

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

  -- 1. Fetch Media Asset with row lock
  SELECT * INTO v_asset
  FROM public.media_assets
  WHERE id = p_media_asset_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Media asset not found.';
  END IF;

  -- 2. Authorization check: Circle vs Group vs 1:1 Conversation
  IF v_asset.circle_id IS NOT NULL THEN
    -- Must be active member of this circle, circle not deleted, parent group within grace, and not banned
    IF NOT EXISTS (
      SELECT 1 FROM public.circle_members cm
      JOIN public.circles c ON c.id = cm.circle_id
      JOIN public.groups g ON g.id = c.group_id
      WHERE cm.circle_id = v_asset.circle_id
        AND cm.user_id = v_caller_id
        AND cm.status = 'active'
        AND c.lifecycle_status <> 'deleted'
        AND g.lifecycle_status IN ('active', 'read_only')
        AND g.grace_expires_at > now()
    ) OR EXISTS (
      SELECT 1 FROM public.group_bans gb
      WHERE gb.group_id = v_asset.group_id AND gb.user_id = v_caller_id
    ) THEN
      RAISE EXCEPTION 'Not authorized: You are not an active member of this circle';
    END IF;
  ELSIF v_asset.group_id IS NOT NULL THEN
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
      'circle_id', v_asset.circle_id,
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

  -- 4. Check recipient save permission
  IF NOT v_asset.allow_recipient_save THEN
    RAISE EXCEPTION 'Sender has restricted saving for this media asset.';
  END IF;

  -- 5. Check if expired
  IF v_asset.expires_at <= now() THEN
    RAISE EXCEPTION 'Cannot save expired media.';
  END IF;

  -- 6. Transition to saved (permanent)
  UPDATE public.media_assets
  SET
    is_saved = true,
    saved_at = now(),
    saved_by_id = v_caller_id,
    updated_at = now()
  WHERE id = p_media_asset_id
  RETURNING * INTO v_asset;

  SELECT jsonb_build_object(
    'id', v_asset.id,
    'conversation_id', v_asset.conversation_id,
    'group_id', v_asset.group_id,
    'circle_id', v_asset.circle_id,
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_media_asset(UUID) TO authenticated;
