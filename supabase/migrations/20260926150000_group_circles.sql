-- ==============================================================================
-- Migration: 20260926150000_group_circles.sql
-- Description: Tchat Group Phase 6.5 — Circles Foundation, Membership, 
--              Conversation, Ephemeral Media & Database-Authoritative Lifecycle.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Create circles Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.circles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  reason TEXT NULL,
  created_by UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'expired', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NULL,

  CONSTRAINT chk_circle_name CHECK (char_length(trim(name)) >= 1 AND char_length(name) <= 60),
  CONSTRAINT chk_circle_reason CHECK (reason IS NULL OR char_length(reason) <= 200),
  CONSTRAINT chk_circle_expires CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_circles_group_lifecycle ON public.circles(group_id, lifecycle_status, expires_at);
CREATE INDEX IF NOT EXISTS idx_circles_creator ON public.circles(created_by);
CREATE INDEX IF NOT EXISTS idx_circles_created_at ON public.circles(created_at DESC);

-- ------------------------------------------------------------------------------
-- 2. Create circle_members Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.circle_members (
  circle_id UUID NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  last_read_message_id UUID NULL,
  last_read_at TIMESTAMPTZ NULL,

  PRIMARY KEY (circle_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_circle_members_user_status ON public.circle_members(user_id, status);
CREATE INDEX IF NOT EXISTS idx_circle_members_circle_status ON public.circle_members(circle_id, status);

-- ------------------------------------------------------------------------------
-- 3. Extend media_assets with circle_id
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'circle_id'
  ) THEN
    ALTER TABLE public.media_assets ADD COLUMN circle_id UUID REFERENCES public.circles(id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_media_assets_circle ON public.media_assets(circle_id);

-- Update media_assets target constraint
ALTER TABLE public.media_assets DROP CONSTRAINT IF EXISTS chk_media_assets_target;
ALTER TABLE public.media_assets ADD CONSTRAINT chk_media_assets_target
  CHECK (
    (conversation_id IS NOT NULL AND group_id IS NULL AND circle_id IS NULL)
    OR (group_id IS NOT NULL AND conversation_id IS NULL)
    OR (conversation_id IS NULL AND group_id IS NULL AND circle_id IS NULL)
  );

-- ------------------------------------------------------------------------------
-- 4. Create circle_messages Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.circle_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id UUID NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'media', 'system')),
  content TEXT NULL,
  media_asset_id UUID NULL REFERENCES public.media_assets(id) ON DELETE SET NULL,
  sequence_number BIGINT GENERATED ALWAYS AS IDENTITY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Text content constraint: 1 to 2000 characters
  CONSTRAINT chk_circle_message_text CHECK (
    message_type <> 'text' OR (content IS NOT NULL AND char_length(trim(content)) >= 1 AND char_length(content) <= 2000)
  ),
  -- Media content constraint: requires media_asset_id or non-empty caption
  CONSTRAINT chk_circle_message_media CHECK (
    message_type <> 'media' OR (media_asset_id IS NOT NULL OR (content IS NOT NULL AND char_length(trim(content)) >= 1))
  )
);

CREATE INDEX IF NOT EXISTS idx_circle_messages_seq ON public.circle_messages(circle_id, sequence_number ASC);
CREATE INDEX IF NOT EXISTS idx_circle_messages_created ON public.circle_messages(circle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_circle_messages_sender ON public.circle_messages(sender_id);

-- Foreign key on circle_members.last_read_message_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'circle_members' AND constraint_name = 'fk_circle_members_last_read'
  ) THEN
    ALTER TABLE public.circle_members
      ADD CONSTRAINT fk_circle_members_last_read
      FOREIGN KEY (last_read_message_id) REFERENCES public.circle_messages(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Row Level Security Policies
-- ------------------------------------------------------------------------------

-- 5.1 circles RLS
ALTER TABLE public.circles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active group members can view unbanned circles" ON public.circles;
CREATE POLICY "Active group members can view unbanned circles"
  ON public.circles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      JOIN public.groups g ON g.id = gm.group_id
      WHERE gm.group_id = circles.group_id
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
        AND g.lifecycle_status IN ('active', 'read_only')
        AND g.grace_expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_bans gb
      WHERE gb.group_id = circles.group_id
        AND gb.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Direct client insert denied on circles" ON public.circles;
CREATE POLICY "Direct client insert denied on circles"
  ON public.circles
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "Direct client update denied on circles" ON public.circles;
CREATE POLICY "Direct client update denied on circles"
  ON public.circles
  FOR UPDATE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS "Direct client delete denied on circles" ON public.circles;
CREATE POLICY "Direct client delete denied on circles"
  ON public.circles
  FOR DELETE
  TO authenticated
  USING (false);

-- 5.2 circle_members RLS
ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Group members can view circle members" ON public.circle_members;
CREATE POLICY "Group members can view circle members"
  ON public.circle_members
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.circles c
      JOIN public.group_members gm ON gm.group_id = c.group_id
      JOIN public.groups g ON g.id = c.group_id
      WHERE c.id = circle_members.circle_id
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
        AND g.lifecycle_status IN ('active', 'read_only')
        AND g.grace_expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.circles c
      JOIN public.group_bans gb ON gb.group_id = c.group_id
      WHERE c.id = circle_members.circle_id
        AND gb.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Direct client write denied on circle_members" ON public.circle_members;
CREATE POLICY "Direct client write denied on circle_members"
  ON public.circle_members
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- 5.3 circle_messages RLS
ALTER TABLE public.circle_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active circle members can read messages" ON public.circle_messages;
CREATE POLICY "Active circle members can read messages"
  ON public.circle_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.circle_members cm
      JOIN public.circles c ON c.id = cm.circle_id
      JOIN public.groups g ON g.id = c.group_id
      WHERE cm.circle_id = circle_messages.circle_id
        AND cm.user_id = auth.uid()
        AND cm.status = 'active'
        AND c.lifecycle_status <> 'deleted'
        AND g.lifecycle_status IN ('active', 'read_only')
        AND g.grace_expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.circles c
      JOIN public.group_bans gb ON gb.group_id = c.group_id
      WHERE c.id = circle_messages.circle_id
        AND gb.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Direct client write denied on circle_messages" ON public.circle_messages;
CREATE POLICY "Direct client write denied on circle_messages"
  ON public.circle_messages
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- 5.4 media_assets RLS for Circle Media
DROP POLICY IF EXISTS "Circle members can read unexpired circle media" ON public.media_assets;
CREATE POLICY "Circle members can read unexpired circle media"
  ON public.media_assets
  FOR SELECT
  TO authenticated
  USING (
    circle_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.circle_members cm
      JOIN public.circles c ON c.id = cm.circle_id
      JOIN public.groups g ON g.id = c.group_id
      WHERE cm.circle_id = media_assets.circle_id
        AND cm.user_id = auth.uid()
        AND cm.status = 'active'
        AND c.lifecycle_status <> 'deleted'
        AND g.lifecycle_status IN ('active', 'read_only')
        AND g.grace_expires_at > now()
        AND (media_assets.is_saved = true OR media_assets.expires_at > now())
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_bans gb
      WHERE gb.group_id = media_assets.group_id
        AND gb.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------------------
-- 6. Circle Lifecycle & Synchronization Engine
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_circle_lifecycle(p_circle_id UUID)
RETURNS public.circles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_circle public.circles;
  v_group public.groups;
BEGIN
  -- 1. Lock circle row for update
  SELECT * INTO v_circle
  FROM public.circles
  WHERE id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 2. Synchronize and check parent group
  v_group := public.sync_group_lifecycle(v_circle.group_id);
  IF v_group IS NULL OR v_group.lifecycle_status = 'deleted' OR now() >= v_group.grace_expires_at THEN
    IF v_circle.lifecycle_status <> 'deleted' THEN
      UPDATE public.circles
      SET lifecycle_status = 'deleted'
      WHERE id = p_circle_id;
      v_circle.lifecycle_status := 'deleted';
    END IF;
    RETURN v_circle;
  END IF;

  -- 3. Evaluate circle expiration or early end
  IF v_circle.ended_at IS NOT NULL OR now() >= v_circle.expires_at THEN
    IF v_circle.lifecycle_status = 'active' THEN
      UPDATE public.circles
      SET lifecycle_status = 'expired'
      WHERE id = p_circle_id;
      v_circle.lifecycle_status := 'expired';
    END IF;
  END IF;

  RETURN v_circle;
END;
$$;

CREATE OR REPLACE FUNCTION public.sweep_circles_lifecycle(p_limit INT DEFAULT 100)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_count INT := 0;
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  -- Mark circles expired if time elapsed or ended
  WITH expired_batch AS (
    SELECT id
    FROM public.circles
    WHERE lifecycle_status = 'active'
      AND (ended_at IS NOT NULL OR expires_at <= now())
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.circles c
  SET lifecycle_status = 'expired'
  FROM expired_batch eb
  WHERE c.id = eb.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Mark circles deleted if parent group is deleted
  WITH deleted_batch AS (
    SELECT c.id
    FROM public.circles c
    JOIN public.groups g ON g.id = c.group_id
    WHERE c.lifecycle_status <> 'deleted'
      AND (g.lifecycle_status = 'deleted' OR g.grace_expires_at <= now())
    LIMIT v_limit
    FOR UPDATE OF c SKIP LOCKED
  )
  UPDATE public.circles c
  SET lifecycle_status = 'deleted'
  FROM deleted_batch db
  WHERE c.id = db.id;

  RETURN v_count;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Authoritative Circle Operations (RPCs)
-- ------------------------------------------------------------------------------

-- 7.1 create_circle RPC
CREATE OR REPLACE FUNCTION public.create_circle(
  p_group_id UUID,
  p_name TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_group public.groups;
  v_member public.group_members;
  v_clean_name TEXT;
  v_clean_reason TEXT;
  v_active_circles_count INT;
  v_circle_id UUID;
  v_created_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Sync parent group lifecycle & verify active
  v_group := public.sync_group_lifecycle(p_group_id);
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  IF v_group.lifecycle_status <> 'active' OR v_group.expires_at <= now() THEN
    RAISE EXCEPTION 'Group is not active or has expired';
  END IF;

  -- 2. Verify caller is an active group member
  SELECT * INTO v_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized: You are not an active member of this group';
  END IF;

  -- 3. Verify caller is not banned
  IF EXISTS (
    SELECT 1 FROM public.group_bans
    WHERE group_id = p_group_id AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'User is banned from this group';
  END IF;

  -- 4. Validate name and optional reason
  v_clean_name := trim(COALESCE(p_name, ''));
  IF char_length(v_clean_name) < 1 OR char_length(v_clean_name) > 60 THEN
    RAISE EXCEPTION 'Circle name must be between 1 and 60 characters';
  END IF;

  v_clean_reason := NULLIF(trim(COALESCE(p_reason, '')), '');
  IF v_clean_reason IS NOT NULL AND char_length(v_clean_reason) > 200 THEN
    RAISE EXCEPTION 'Circle reason/description cannot exceed 200 characters';
  END IF;

  -- 5. Safe capacity safeguard: Maximum 10 active circles concurrently per group
  SELECT COUNT(*) INTO v_active_circles_count
  FROM public.circles
  WHERE group_id = p_group_id
    AND lifecycle_status = 'active'
    AND expires_at > now()
    AND ended_at IS NULL;

  IF v_active_circles_count >= 10 THEN
    RAISE EXCEPTION 'Group has reached maximum active circles limit (10)';
  END IF;

  -- 6. Authoritative timestamps (fixed 24 hours lifetime)
  v_created_at := now();
  v_expires_at := v_created_at + INTERVAL '24 hours';

  -- 7. Insert circle
  INSERT INTO public.circles (
    group_id,
    name,
    reason,
    created_by,
    lifecycle_status,
    created_at,
    expires_at,
    ended_at
  )
  VALUES (
    p_group_id,
    v_clean_name,
    v_clean_reason,
    v_caller_id,
    'active',
    v_created_at,
    v_expires_at,
    NULL
  )
  RETURNING id INTO v_circle_id;

  -- 8. Creator automatically becomes active circle member
  INSERT INTO public.circle_members (
    circle_id,
    user_id,
    joined_at,
    status
  )
  VALUES (
    v_circle_id,
    v_caller_id,
    v_created_at,
    'active'
  );

  -- 9. Build and return result
  SELECT jsonb_build_object(
    'id', c.id,
    'group_id', c.group_id,
    'name', c.name,
    'reason', c.reason,
    'created_by', c.created_by,
    'lifecycle_status', c.lifecycle_status,
    'created_at', c.created_at,
    'expires_at', c.expires_at,
    'ended_at', c.ended_at,
    'member_count', 1,
    'is_member', true,
    'is_creator', true,
    'creator', jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url
    )
  ) INTO v_result
  FROM public.circles c
  LEFT JOIN public.profiles p ON p.id = c.created_by
  WHERE c.id = v_circle_id;

  RETURN v_result;
END;
$$;

-- 7.2 join_circle RPC
CREATE OR REPLACE FUNCTION public.join_circle(p_circle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_circle public.circles;
  v_group public.groups;
  v_member_count INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Sync circle lifecycle
  v_circle := public.sync_circle_lifecycle(p_circle_id);
  IF v_circle IS NULL OR v_circle.lifecycle_status = 'deleted' THEN
    RAISE EXCEPTION 'Circle not found';
  END IF;

  IF v_circle.lifecycle_status = 'expired' OR v_circle.expires_at <= now() OR v_circle.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Circle has expired and cannot accept new members';
  END IF;

  -- 2. Verify parent group is active
  SELECT * INTO v_group
  FROM public.groups
  WHERE id = v_circle.group_id;

  IF v_group.lifecycle_status <> 'active' OR v_group.expires_at <= now() THEN
    RAISE EXCEPTION 'Parent group is not active or has expired';
  END IF;

  -- 3. Verify caller is an active group member
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_circle.group_id AND user_id = v_caller_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized: You are not an active member of the parent group';
  END IF;

  -- 4. Verify caller is not banned
  IF EXISTS (
    SELECT 1 FROM public.group_bans
    WHERE group_id = v_circle.group_id AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'User is banned from this group';
  END IF;

  -- 5. Insert or update circle membership
  INSERT INTO public.circle_members (
    circle_id,
    user_id,
    joined_at,
    left_at,
    status
  )
  VALUES (
    p_circle_id,
    v_caller_id,
    now(),
    NULL,
    'active'
  )
  ON CONFLICT (circle_id, user_id) DO UPDATE
  SET status = 'active',
      left_at = NULL,
      joined_at = CASE WHEN circle_members.status = 'left' THEN now() ELSE circle_members.joined_at END;

  SELECT COUNT(*) INTO v_member_count
  FROM public.circle_members
  WHERE circle_id = p_circle_id AND status = 'active';

  RETURN jsonb_build_object(
    'success', true,
    'circle_id', p_circle_id,
    'member_count', v_member_count,
    'is_member', true
  );
END;
$$;

-- 7.3 leave_circle RPC
CREATE OR REPLACE FUNCTION public.leave_circle(p_circle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_member_count INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.circle_members
    WHERE circle_id = p_circle_id AND user_id = v_caller_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'You are not an active member of this circle';
  END IF;

  UPDATE public.circle_members
  SET status = 'left',
      left_at = now()
  WHERE circle_id = p_circle_id AND user_id = v_caller_id;

  SELECT COUNT(*) INTO v_member_count
  FROM public.circle_members
  WHERE circle_id = p_circle_id AND status = 'active';

  RETURN jsonb_build_object(
    'success', true,
    'circle_id', p_circle_id,
    'member_count', v_member_count,
    'is_member', false
  );
END;
$$;

-- 7.4 end_circle RPC
CREATE OR REPLACE FUNCTION public.end_circle(p_circle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_circle public.circles;
  v_group_role TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_circle
  FROM public.circles
  WHERE id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Circle not found';
  END IF;

  -- Caller must be creator or parent group admin/mod
  v_group_role := public.get_group_member_role(v_circle.group_id, v_caller_id);

  IF v_circle.created_by <> v_caller_id AND (v_group_role IS NULL OR v_group_role NOT IN ('admin', 'mod')) THEN
    RAISE EXCEPTION 'Only the circle creator or group admin can end this circle';
  END IF;

  UPDATE public.circles
  SET ended_at = now(),
      lifecycle_status = 'expired'
  WHERE id = p_circle_id;

  RETURN jsonb_build_object(
    'success', true,
    'circle_id', p_circle_id,
    'ended_at', now(),
    'lifecycle_status', 'expired'
  );
END;
$$;

-- 7.5 get_group_circles RPC
CREATE OR REPLACE FUNCTION public.get_group_circles(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_circles JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify caller is active group member
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = v_caller_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized: You are not an active member of this group';
  END IF;

  -- Proactive sweep
  PERFORM public.sweep_circles_lifecycle(50);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'group_id', c.group_id,
        'name', c.name,
        'reason', c.reason,
        'created_by', c.created_by,
        'lifecycle_status', c.lifecycle_status,
        'created_at', c.created_at,
        'expires_at', c.expires_at,
        'ended_at', c.ended_at,
        'member_count', (
          SELECT COUNT(*)::INT 
          FROM public.circle_members cm 
          WHERE cm.circle_id = c.id AND cm.status = 'active'
        ),
        'is_member', EXISTS (
          SELECT 1 FROM public.circle_members cm 
          WHERE cm.circle_id = c.id AND cm.user_id = v_caller_id AND cm.status = 'active'
        ),
        'is_creator', (c.created_by = v_caller_id),
        'creator', jsonb_build_object(
          'id', p.id,
          'username', p.username,
          'display_name', p.display_name,
          'avatar_url', p.avatar_url
        )
      ) ORDER BY c.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_circles
  FROM public.circles c
  LEFT JOIN public.profiles p ON p.id = c.created_by
  WHERE c.group_id = p_group_id
    AND c.lifecycle_status = 'active'
    AND c.expires_at > now()
    AND c.ended_at IS NULL;

  RETURN v_circles;
END;
$$;

-- 7.6 get_circle_details RPC
CREATE OR REPLACE FUNCTION public.get_circle_details(p_circle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_circle public.circles;
  v_group public.groups;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Synchronize circle lifecycle
  v_circle := public.sync_circle_lifecycle(p_circle_id);
  IF v_circle IS NULL OR v_circle.lifecycle_status = 'deleted' THEN
    RETURN NULL;
  END IF;

  -- Verify group membership
  SELECT * INTO v_group
  FROM public.groups
  WHERE id = v_circle.group_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_circle.group_id AND user_id = v_caller_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized: You are not an active member of the parent group';
  END IF;

  SELECT jsonb_build_object(
    'id', c.id,
    'group_id', c.group_id,
    'name', c.name,
    'reason', c.reason,
    'created_by', c.created_by,
    'lifecycle_status', c.lifecycle_status,
    'created_at', c.created_at,
    'expires_at', c.expires_at,
    'ended_at', c.ended_at,
    'parent_group_status', v_group.lifecycle_status,
    'member_count', (
      SELECT COUNT(*)::INT 
      FROM public.circle_members cm 
      WHERE cm.circle_id = c.id AND cm.status = 'active'
    ),
    'is_member', EXISTS (
      SELECT 1 FROM public.circle_members cm 
      WHERE cm.circle_id = c.id AND cm.user_id = v_caller_id AND cm.status = 'active'
    ),
    'is_creator', (c.created_by = v_caller_id),
    'creator', jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url
    )
  ) INTO v_result
  FROM public.circles c
  LEFT JOIN public.profiles p ON p.id = c.created_by
  WHERE c.id = p_circle_id;

  RETURN v_result;
END;
$$;

-- 7.7 create_circle_media_asset RPC
CREATE OR REPLACE FUNCTION public.create_circle_media_asset(
  p_circle_id UUID,
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
  v_circle public.circles;
  v_group public.groups;
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

  -- 1. Sync circle & verify active
  v_circle := public.sync_circle_lifecycle(p_circle_id);
  IF v_circle IS NULL OR v_circle.lifecycle_status <> 'active' OR v_circle.expires_at <= now() THEN
    RAISE EXCEPTION 'Circle is not active or has expired';
  END IF;

  -- 2. Verify parent group is active
  SELECT * INTO v_group
  FROM public.groups
  WHERE id = v_circle.group_id;

  IF v_group.lifecycle_status <> 'active' OR v_group.expires_at <= now() THEN
    RAISE EXCEPTION 'Parent group is not active or has expired';
  END IF;

  -- 3. Verify caller is active circle member
  IF NOT EXISTS (
    SELECT 1 FROM public.circle_members
    WHERE circle_id = p_circle_id AND user_id = v_caller_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized: You are not an active member of this circle';
  END IF;

  -- 4. Verify caller not banned from parent group
  IF EXISTS (
    SELECT 1 FROM public.group_bans
    WHERE group_id = v_circle.group_id AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'User is banned from this group';
  END IF;

  -- 5. Validate media type and size
  IF p_media_type NOT IN ('image', 'video', 'audio', 'file') THEN
    RAISE EXCEPTION 'Unsupported media type: %', p_media_type;
  END IF;

  IF p_file_size_bytes IS NOT NULL AND (p_file_size_bytes <= 0 OR p_file_size_bytes > 52428800) THEN
    RAISE EXCEPTION 'File size out of allowed bounds (1B - 50MB)';
  END IF;

  v_created_at := now();
  v_expires_at := v_created_at + INTERVAL '24 hours';
  v_clean_filename := substring(trim(COALESCE(p_original_filename, 'attachment')) from 1 for 150);

  INSERT INTO public.media_assets (
    group_id,
    circle_id,
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
    v_circle.group_id,
    p_circle_id,
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
    'circle_id', ma.circle_id,
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

-- 7.8 send_circle_message RPC
CREATE OR REPLACE FUNCTION public.send_circle_message(
  p_circle_id UUID,
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
  v_circle public.circles;
  v_group public.groups;
  v_clean_content TEXT;
  v_msg_id UUID;
  v_seq BIGINT;
  v_created_at TIMESTAMPTZ;
  v_sender_profile RECORD;
  v_media public.media_assets;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Lock circle row for concurrency & status evaluation
  SELECT * INTO v_circle
  FROM public.circles
  WHERE id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Circle not found';
  END IF;

  -- 2. Verify circle active
  IF v_circle.lifecycle_status <> 'active' OR v_circle.expires_at <= now() OR v_circle.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Circle is not active or has expired';
  END IF;

  -- 3. Verify parent group is active (cannot interact if parent group is read_only or deleted)
  SELECT * INTO v_group
  FROM public.groups
  WHERE id = v_circle.group_id;

  IF v_group.lifecycle_status <> 'active' OR v_group.expires_at <= now() THEN
    RAISE EXCEPTION 'Parent group is not active or has expired';
  END IF;

  -- 4. Verify caller is an active circle member
  IF NOT EXISTS (
    SELECT 1 FROM public.circle_members
    WHERE circle_id = p_circle_id AND user_id = v_caller_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized: You are not an active member of this circle';
  END IF;

  -- 5. Verify caller is not banned from parent group
  IF EXISTS (
    SELECT 1 FROM public.group_bans
    WHERE group_id = v_circle.group_id AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'User is banned from this group';
  END IF;

  -- 6. Validate content & message type
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

    IF p_media_asset_id IS NOT NULL THEN
      SELECT * INTO v_media
      FROM public.media_assets
      WHERE id = p_media_asset_id AND circle_id = p_circle_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Media asset not found or does not belong to this circle';
      END IF;
    END IF;
  ELSIF p_message_type = 'system' THEN
    v_clean_content := trim(p_content);
    IF v_clean_content IS NULL OR char_length(v_clean_content) < 1 THEN
      RAISE EXCEPTION 'System message content cannot be empty';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported message type: %', p_message_type;
  END IF;

  -- 7. Insert message
  INSERT INTO public.circle_messages (
    circle_id,
    sender_id,
    message_type,
    content,
    media_asset_id
  )
  VALUES (
    p_circle_id,
    v_caller_id,
    p_message_type,
    v_clean_content,
    p_media_asset_id
  )
  RETURNING id, sequence_number, created_at INTO v_msg_id, v_seq, v_created_at;

  -- 8. Fetch sender profile
  SELECT username, display_name, avatar_url INTO v_sender_profile
  FROM public.profiles
  WHERE id = v_caller_id;

  SELECT jsonb_build_object(
    'id', v_msg_id,
    'circle_id', p_circle_id,
    'sender_id', v_caller_id,
    'message_type', p_message_type,
    'content', v_clean_content,
    'media_asset_id', p_media_asset_id,
    'sequence_number', v_seq,
    'created_at', v_created_at,
    'sender_username', v_sender_profile.username,
    'sender_display_name', v_sender_profile.display_name,
    'sender_avatar_url', v_sender_profile.avatar_url,
    'media', CASE WHEN p_media_asset_id IS NOT NULL AND v_media.id IS NOT NULL THEN jsonb_build_object(
      'id', v_media.id,
      'storage_path', v_media.storage_path,
      'media_type', v_media.media_type,
      'mime_type', v_media.mime_type,
      'file_size_bytes', v_media.file_size_bytes,
      'original_filename', v_media.original_filename,
      'allow_recipient_save', v_media.allow_recipient_save,
      'is_saved', v_media.is_saved,
      'expires_at', v_media.expires_at,
      'is_expired', (v_media.expires_at <= now() AND NOT v_media.is_saved)
    ) ELSE NULL END
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 7.9 get_circle_messages RPC
CREATE OR REPLACE FUNCTION public.get_circle_messages(
  p_circle_id UUID,
  p_limit INT DEFAULT 50,
  p_before_seq BIGINT DEFAULT NULL,
  p_after_seq BIGINT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  circle_id UUID,
  sender_id UUID,
  message_type TEXT,
  content TEXT,
  media_asset_id UUID,
  sequence_number BIGINT,
  created_at TIMESTAMPTZ,
  sender_username TEXT,
  sender_display_name TEXT,
  sender_avatar_url TEXT,
  media JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_circle public.circles;
  v_group public.groups;
  v_safe_limit INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_circle
  FROM public.circles
  WHERE circles.id = p_circle_id;

  IF NOT FOUND OR v_circle.lifecycle_status = 'deleted' THEN
    RAISE EXCEPTION 'Circle not found';
  END IF;

  SELECT * INTO v_group
  FROM public.groups
  WHERE groups.id = v_circle.group_id;

  IF v_group.lifecycle_status = 'deleted' OR v_group.grace_expires_at <= now() THEN
    RAISE EXCEPTION 'Parent group is deleted';
  END IF;

  -- Caller must be active member of circle
  IF NOT EXISTS (
    SELECT 1 FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id AND cm.user_id = v_caller_id AND cm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized: You are not an active member of this circle';
  END IF;

  v_safe_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);

  RETURN QUERY
  SELECT 
    cm.id,
    cm.circle_id,
    cm.sender_id,
    cm.message_type,
    cm.content,
    cm.media_asset_id,
    cm.sequence_number,
    cm.created_at,
    p.username AS sender_username,
    p.display_name AS sender_display_name,
    p.avatar_url AS sender_avatar_url,
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
  FROM public.circle_messages cm
  LEFT JOIN public.profiles p ON p.id = cm.sender_id
  LEFT JOIN public.media_assets ma ON ma.id = cm.media_asset_id
  WHERE cm.circle_id = p_circle_id
    AND (p_before_seq IS NULL OR cm.sequence_number < p_before_seq)
    AND (p_after_seq IS NULL OR cm.sequence_number > p_after_seq)
  ORDER BY cm.sequence_number ASC
  LIMIT v_safe_limit;
END;
$$;

-- 7.10 mark_circle_messages_read RPC
CREATE OR REPLACE FUNCTION public.mark_circle_messages_read(
  p_circle_id UUID,
  p_message_id UUID
)
RETURNS JSONB
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

  UPDATE public.circle_members
  SET last_read_message_id = p_message_id,
      last_read_at = now()
  WHERE circle_id = p_circle_id AND user_id = v_caller_id AND status = 'active';

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 7.11 list_circle_members RPC
CREATE OR REPLACE FUNCTION public.list_circle_members(p_circle_id UUID)
RETURNS TABLE (
  circle_id UUID,
  user_id UUID,
  joined_at TIMESTAMPTZ,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_circle public.circles;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_circle
  FROM public.circles
  WHERE circles.id = p_circle_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Circle not found';
  END IF;

  -- Caller must be active member of parent group
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = v_circle.group_id AND gm.user_id = v_caller_id AND gm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized: You are not an active member of this group';
  END IF;

  RETURN QUERY
  SELECT 
    cm.circle_id,
    cm.user_id,
    cm.joined_at,
    p.username,
    p.display_name,
    p.avatar_url
  FROM public.circle_members cm
  JOIN public.profiles p ON p.id = cm.user_id
  WHERE cm.circle_id = p_circle_id AND cm.status = 'active'
  ORDER BY cm.joined_at ASC;
END;
$$;
