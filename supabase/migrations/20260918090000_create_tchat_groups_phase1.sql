-- ============================================================================
-- Migration: 20260918090000_create_tchat_groups_phase1.sql
-- Description: Groups Phase 1: Core Group entity, membership, bans, requests,
--              role limits, and RLS security foundation.
-- ============================================================================

-- 1. Create Core Groups Table
CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  reason TEXT NOT NULL,
  cover_url TEXT NULL,
  lifetime TEXT NOT NULL CHECK (lifetime IN ('1_day', '3_days', '1_week')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  grace_expires_at TIMESTAMPTZ NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'discoverable')),
  access_mode TEXT NOT NULL CHECK (access_mode IN ('open', 'request', 'question')),
  joining_question TEXT NULL,
  max_size INT NOT NULL DEFAULT 30 CHECK (max_size >= 2 AND max_size <= 30),
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'read_only', 'deleted')),
  created_by_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Structural Constraints
  CONSTRAINT chk_group_name_length CHECK (char_length(trim(name)) >= 2 AND char_length(trim(name)) <= 60),
  CONSTRAINT chk_group_reason_length CHECK (char_length(trim(reason)) >= 3 AND char_length(trim(reason)) <= 300),
  CONSTRAINT chk_group_private_not_open CHECK (NOT (visibility = 'private' AND access_mode = 'open')),
  CONSTRAINT chk_group_question_mode CHECK (
    (access_mode = 'question' AND joining_question IS NOT NULL AND char_length(trim(joining_question)) >= 3 AND char_length(trim(joining_question)) <= 300) OR
    (access_mode <> 'question' AND joining_question IS NULL)
  ),
  CONSTRAINT chk_group_expiration_order CHECK (expires_at > created_at AND grace_expires_at > expires_at)
);

-- 2. Create Group Members Table
CREATE TABLE IF NOT EXISTS public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'mod', 'special', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'removed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ NULL,
  removed_at TIMESTAMPTZ NULL,
  removed_by_id UUID NULL REFERENCES public.accounts(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_member_status_timestamps CHECK (
    (status = 'active' AND left_at IS NULL AND removed_at IS NULL) OR
    (status = 'left' AND left_at IS NOT NULL) OR
    (status = 'removed' AND removed_at IS NOT NULL)
  )
);

-- Partial Unique Indexes for Member Constraints
-- Only one active membership per user per group
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_unique_active_user 
  ON public.group_members (group_id, user_id) 
  WHERE status = 'active';

-- At most one active Admin per group
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_unique_admin 
  ON public.group_members (group_id) 
  WHERE role = 'admin' AND status = 'active';

-- At most one active Mod per group
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_unique_mod 
  ON public.group_members (group_id) 
  WHERE role = 'mod' AND status = 'active';

-- General lookup indexes
CREATE INDEX IF NOT EXISTS idx_group_members_user_status ON public.group_members (user_id, status);
CREATE INDEX IF NOT EXISTS idx_group_members_group_status ON public.group_members (group_id, status);

-- 3. Create Group Bans Table
CREATE TABLE IF NOT EXISTS public.group_bans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  banned_by_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_group_bans_group_user UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_bans_user ON public.group_bans (user_id);
CREATE INDEX IF NOT EXISTS idx_group_bans_group ON public.group_bans (group_id);

-- 4. Create Group Join Requests Table
CREATE TABLE IF NOT EXISTS public.group_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  question_answer TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  reviewed_by_id UUID NULL REFERENCES public.accounts(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_join_requests_unique_pending 
  ON public.group_join_requests (group_id, user_id) 
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_group_join_requests_group_status 
  ON public.group_join_requests (group_id, status);

-- ============================================================================
-- 5. Invariant Enforcement: Exactly One Admin & Role Limits
-- ============================================================================

-- Function to check role and admin invariants on group_members
CREATE OR REPLACE FUNCTION public.check_group_admin_and_role_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_gid UUID;
  v_group RECORD;
  v_admin_count INT;
  v_mod_count INT;
  v_special_count INT;
BEGIN
  v_gid := COALESCE(NEW.group_id, OLD.group_id);

  -- Fetch group record
  SELECT id, lifecycle_status, max_size INTO v_group
  FROM public.groups
  WHERE id = v_gid;

  -- Only enforce for operating active groups (if group row deleted, cascaded delete is fine)
  IF FOUND AND v_group.lifecycle_status = 'active' THEN
    SELECT 
      COUNT(*) FILTER (WHERE role = 'admin' AND status = 'active'),
      COUNT(*) FILTER (WHERE role = 'mod' AND status = 'active'),
      COUNT(*) FILTER (WHERE role = 'special' AND status = 'active')
    INTO v_admin_count, v_mod_count, v_special_count
    FROM public.group_members
    WHERE group_id = v_gid;

    -- EXACTLY ONE ADMIN for an operating active group
    IF v_admin_count <> 1 THEN
      RAISE EXCEPTION 'Operating active group must have exactly one active admin (found %)', v_admin_count;
    END IF;

    -- AT MOST ONE MOD
    IF v_mod_count > 1 THEN
      RAISE EXCEPTION 'Group cannot have more than 1 active mod (found %)', v_mod_count;
    END IF;

    -- AT MOST FIVE SPECIALS
    IF v_special_count > 5 THEN
      RAISE EXCEPTION 'Group cannot have more than 5 active specials (found %)', v_special_count;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_group_admin_and_roles ON public.group_members;
CREATE CONSTRAINT TRIGGER trg_check_group_admin_and_roles
AFTER INSERT OR UPDATE OR DELETE ON public.group_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.check_group_admin_and_role_invariants();

-- Function to check exactly one admin on group creation/lifecycle change
CREATE OR REPLACE FUNCTION public.check_group_creation_admin_invariant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_admin_count INT;
BEGIN
  IF NEW.lifecycle_status = 'active' THEN
    SELECT COUNT(*) INTO v_admin_count
    FROM public.group_members
    WHERE group_id = NEW.id AND role = 'admin' AND status = 'active';

    IF v_admin_count <> 1 THEN
      RAISE EXCEPTION 'Operating active group must have exactly one active admin upon creation (found %)', v_admin_count;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_group_creation_admin ON public.groups;
CREATE CONSTRAINT TRIGGER trg_check_group_creation_admin
AFTER INSERT OR UPDATE ON public.groups
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.check_group_creation_admin_invariant();

-- ============================================================================
-- 6. Helper Security & Status Functions
-- ============================================================================

-- Active membership check
CREATE OR REPLACE FUNCTION public.is_group_active_member(p_group_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.group_members 
    WHERE group_id = p_group_id 
      AND user_id = p_user_id 
      AND status = 'active'
  );
$$;

-- Member role getter
CREATE OR REPLACE FUNCTION public.get_group_member_role(p_group_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT role 
  FROM public.group_members 
  WHERE group_id = p_group_id 
    AND user_id = p_user_id 
    AND status = 'active'
  LIMIT 1;
$$;

-- Ban check
CREATE OR REPLACE FUNCTION public.is_user_group_banned(p_group_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.group_bans 
    WHERE group_id = p_group_id 
      AND user_id = p_user_id
  );
$$;

-- Active member count
CREATE OR REPLACE FUNCTION public.get_group_active_member_count(p_group_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT count(*)::INT
  FROM public.group_members
  WHERE group_id = p_group_id AND status = 'active';
$$;

-- Effective access mode calculation:
-- If active members >= ceil(max_size / 2.0) and configured access_mode is 'open',
-- effective access automatically becomes 'request'.
CREATE OR REPLACE FUNCTION public.get_group_effective_access_mode(p_group_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_group RECORD;
  v_active_count INT;
  v_threshold INT;
BEGIN
  SELECT access_mode, max_size INTO v_group
  FROM public.groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_group.access_mode <> 'open' THEN
    RETURN v_group.access_mode;
  END IF;

  SELECT count(*)::INT INTO v_active_count
  FROM public.group_members
  WHERE group_id = p_group_id AND status = 'active';

  -- Ceiling of max_size / 2.0 (e.g. 30 -> 15, 15 -> 8)
  v_threshold := ceil(v_group.max_size / 2.0);

  IF v_active_count >= v_threshold THEN
    RETURN 'request';
  END IF;

  RETURN 'open';
END;
$$;

-- ============================================================================
-- 7. Row Level Security (RLS) Policies
-- ============================================================================

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_join_requests ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Policies for public.groups
-- ----------------------------------------------------------------------------

-- SELECT: Members can always view their active group.
-- Non-members can only discover groups that are discoverable, not deleted,
-- not grace-expired, and where the caller is not banned.
CREATE POLICY p_groups_select ON public.groups
FOR SELECT
TO authenticated
USING (
  -- Active member
  public.is_group_active_member(id, auth.uid())
  OR
  -- Discoverable group check
  (
    visibility = 'discoverable'
    AND lifecycle_status <> 'deleted'
    AND now() < grace_expires_at
    AND NOT public.is_user_group_banned(id, auth.uid())
  )
  OR
  -- Creator fallback
  created_by_id = auth.uid()
);

-- Mutations to groups table are restricted to SECURITY DEFINER functions/RPCs
CREATE POLICY p_groups_insert_deny ON public.groups FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY p_groups_update_deny ON public.groups FOR UPDATE TO authenticated USING (false);
CREATE POLICY p_groups_delete_deny ON public.groups FOR DELETE TO authenticated USING (false);

-- ----------------------------------------------------------------------------
-- Policies for public.group_members
-- ----------------------------------------------------------------------------

-- SELECT: Active members of the group can view the members list.
-- Users can always view their own membership record (even if left/removed).
CREATE POLICY p_group_members_select ON public.group_members
FOR SELECT
TO authenticated
USING (
  public.is_group_active_member(group_id, auth.uid())
  OR user_id = auth.uid()
);

-- Member mutations must go through authorized RPCs
CREATE POLICY p_group_members_insert_deny ON public.group_members FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY p_group_members_update_deny ON public.group_members FOR UPDATE TO authenticated USING (false);
CREATE POLICY p_group_members_delete_deny ON public.group_members FOR DELETE TO authenticated USING (false);

-- ----------------------------------------------------------------------------
-- Policies for public.group_bans
-- ----------------------------------------------------------------------------

-- SELECT: Group Admin and Mod can inspect bans.
-- A banned user can inspect their own ban record.
CREATE POLICY p_group_bans_select ON public.group_bans
FOR SELECT
TO authenticated
USING (
  public.get_group_member_role(group_id, auth.uid()) IN ('admin', 'mod')
  OR user_id = auth.uid()
);

-- Ban mutations must go through authorized RPCs
CREATE POLICY p_group_bans_insert_deny ON public.group_bans FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY p_group_bans_update_deny ON public.group_bans FOR UPDATE TO authenticated USING (false);
CREATE POLICY p_group_bans_delete_deny ON public.group_bans FOR DELETE TO authenticated USING (false);

-- ----------------------------------------------------------------------------
-- Policies for public.group_join_requests
-- ----------------------------------------------------------------------------

-- SELECT: Group Admin and Mod can view pending join requests.
-- Requester can view their own join request.
CREATE POLICY p_group_join_requests_select ON public.group_join_requests
FOR SELECT
TO authenticated
USING (
  public.get_group_member_role(group_id, auth.uid()) IN ('admin', 'mod')
  OR user_id = auth.uid()
);

-- Request mutations must go through authorized RPCs
CREATE POLICY p_group_join_requests_insert_deny ON public.group_join_requests FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY p_group_join_requests_update_deny ON public.group_join_requests FOR UPDATE TO authenticated USING (false);
CREATE POLICY p_group_join_requests_delete_deny ON public.group_join_requests FOR DELETE TO authenticated USING (false);

-- ============================================================================
-- 8. Grants
-- ============================================================================

GRANT SELECT ON public.groups TO authenticated;
GRANT SELECT ON public.group_members TO authenticated;
GRANT SELECT ON public.group_bans TO authenticated;
GRANT SELECT ON public.group_join_requests TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_group_active_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_member_role(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_group_banned(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_active_member_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_effective_access_mode(UUID) TO authenticated;
