-- ==============================================================================
-- Tchat: Groups Domain Stage 4 — Membership & Access Operations RPCs
-- Migration: 20260918100000_groups_membership_and_access_operations.sql
-- Description: Server-authoritative, race-safe RPCs for Group creation, direct join,
--              join requests, request review, role assignment, admin transfer,
--              removals, bans, and admin succession on leave.
-- ==============================================================================

-- Ensure get_group_member_role returns 'none' instead of NULL when caller is not an active member
CREATE OR REPLACE FUNCTION public.get_group_member_role(p_group_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.group_members WHERE group_id = p_group_id AND user_id = p_user_id AND status = 'active' LIMIT 1),
    'none'
  );
$$;

-- ------------------------------------------------------------------------------
-- 1. Create Group RPC (Atomic group + initial admin membership)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_group(
  p_name TEXT,
  p_reason TEXT,
  p_lifetime TEXT,
  p_visibility TEXT,
  p_access_mode TEXT,
  p_joining_question TEXT DEFAULT NULL,
  p_max_size INT DEFAULT 30,
  p_cover_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_grace_expires_at TIMESTAMPTZ;
  v_group_id UUID;
  v_group RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate lifetime
  IF p_lifetime = '1_day' THEN
    v_expires_at := now() + interval '1 day';
  ELSIF p_lifetime = '3_days' THEN
    v_expires_at := now() + interval '3 days';
  ELSIF p_lifetime = '1_week' THEN
    v_expires_at := now() + interval '7 days';
  ELSE
    RAISE EXCEPTION 'Invalid group lifetime: %. Allowed: 1_day, 3_days, 1_week', p_lifetime;
  END IF;

  v_grace_expires_at := v_expires_at + interval '7 days';

  -- Atomically insert group
  INSERT INTO public.groups (
    name,
    reason,
    lifetime,
    expires_at,
    grace_expires_at,
    visibility,
    access_mode,
    joining_question,
    max_size,
    cover_url,
    created_by_id,
    lifecycle_status
  ) VALUES (
    trim(p_name),
    trim(p_reason),
    p_lifetime,
    v_expires_at,
    v_grace_expires_at,
    p_visibility,
    p_access_mode,
    CASE WHEN p_access_mode = 'question' THEN trim(p_joining_question) ELSE NULL END,
    COALESCE(p_max_size, 30),
    p_cover_url,
    v_caller_id,
    'active'
  ) RETURNING id INTO v_group_id;

  -- Atomically insert creator as the single active Admin
  INSERT INTO public.group_members (
    group_id,
    user_id,
    role,
    status,
    joined_at
  ) VALUES (
    v_group_id,
    v_caller_id,
    'admin',
    'active',
    now()
  );

  SELECT * INTO v_group FROM public.groups WHERE id = v_group_id;

  RETURN jsonb_build_object(
    'group_id', v_group.id,
    'name', v_group.name,
    'reason', v_group.reason,
    'lifetime', v_group.lifetime,
    'expires_at', v_group.expires_at,
    'grace_expires_at', v_group.grace_expires_at,
    'visibility', v_group.visibility,
    'access_mode', v_group.access_mode,
    'effective_access_mode', v_group.access_mode,
    'max_size', v_group.max_size,
    'member_count', 1,
    'role', 'admin'
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. Join Group RPC (Direct join for open groups with capacity & surge locking)
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
  v_group RECORD;
  v_active_count INT;
  v_effective_mode TEXT;
  v_existing_member RECORD;
  v_admin_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Row lock the group to guarantee race-safe capacity check
  SELECT * INTO v_group
  FROM public.groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  IF v_group.lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'Group is no longer active';
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
  -- Rejoining must NOT restore previous role!
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
-- 3. Request to Join Group RPC (For request / question modes or 50% surge)
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
  v_group RECORD;
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

  SELECT * INTO v_group
  FROM public.groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
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
-- 4. Cancel Join Request RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_group_join_request(
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_request RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_request
  FROM public.group_join_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join request not found';
  END IF;

  IF v_request.user_id <> v_caller_id THEN
    RAISE EXCEPTION 'Only the requester can cancel their request';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending requests can be cancelled';
  END IF;

  UPDATE public.group_join_requests
  SET status = 'cancelled'
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'cancelled');
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Approve Join Request RPC (Caller must be Admin or Mod)
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
  v_group RECORD;
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

  -- Row lock group for capacity check
  SELECT * INTO v_group
  FROM public.groups
  WHERE id = v_request.group_id
  FOR UPDATE;

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
-- 6. Decline Join Request RPC (Caller must be Admin or Mod)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decline_group_join_request(
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
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_request
  FROM public.group_join_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Join request is no longer pending';
  END IF;

  v_caller_role := public.get_group_member_role(v_request.group_id, v_caller_id);
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'mod') THEN
    RAISE EXCEPTION 'Only group admins or moderators can decline join requests';
  END IF;

  UPDATE public.group_join_requests
  SET status = 'declined', reviewed_by_id = v_caller_id, reviewed_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'declined');
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Assign Member Role RPC (Admin assigns Mod, Special, Member)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 8. Transfer Admin RPC (Atomic role swap between Admin and Successor)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 9. Remove Group Member RPC (Admin or Mod removes member)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 10. Ban Group Member RPC (Admin or Mod bans user from group)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 11. Unban Group Member RPC (Admin or Mod unbans user)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 12. Leave Group RPC (Atomic succession for admin or dissolution if sole member)
-- ------------------------------------------------------------------------------
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

    -- Atomic succession and departure
    UPDATE public.group_members
    SET role = 'admin'
    WHERE id = v_successor_member.id;

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
      'new_admin_id', p_successor_user_id,
      'remaining_members', v_active_count - 1
    );
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 13. Read Helpers RPCs (Get group details, list members, get requests)
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
  v_group RECORD;
  v_member_record RECORD;
  v_active_count INT;
  v_effective_mode TEXT;
  v_admin_profile RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_group
  FROM public.groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
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

-- 14. List Group Members RPC (Active members only can view list)
CREATE OR REPLACE FUNCTION public.list_group_members(
  p_group_id UUID
)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT,
  joined_at TIMESTAMPTZ
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

  IF NOT public.is_group_active_member(p_group_id, v_caller_id) THEN
    RAISE EXCEPTION 'Only active group members can view the member list';
  END IF;

  RETURN QUERY
  SELECT
    gm.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    gm.role,
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

-- 15. Get Group Join Requests (Admins and Mods only)
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
