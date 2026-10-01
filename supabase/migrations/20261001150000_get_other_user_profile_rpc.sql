-- ==============================================================================
-- Tchat: Other User Profile & Relationship Resolution Migration
-- Migration: 20261001150000_get_other_user_profile_rpc.sql
-- Description: Provides atomic, server-authoritative relationship resolution
--              and public profile retrieval for other Tchat users.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_other_user_profile(
  p_target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_profile RECORD;
  v_account RECORD;
  v_status TEXT := 'not_connected';
  v_pending_req_id UUID := NULL;
  v_pending_context TEXT := NULL;
  v_conv_id UUID := NULL;
  v_result JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Fetch public profile
  SELECT id, username, normalized_username, display_name, avatar_url, bio, created_at
  INTO v_profile
  FROM public.profiles
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found.';
  END IF;

  -- 2. Verify account is active
  SELECT status INTO v_account
  FROM public.accounts
  WHERE id = p_target_user_id;

  IF v_account IS NULL OR v_account.status <> 'active' THEN
    RAISE EXCEPTION 'This account is not available.';
  END IF;

  -- 3. Determine relationship status
  IF v_caller_id = p_target_user_id THEN
    v_status := 'self';
  ELSIF EXISTS (
    SELECT 1 FROM public.blocks
    WHERE blocker_id = v_caller_id AND blocked_id = p_target_user_id
  ) THEN
    v_status := 'blocked';
  ELSIF EXISTS (
    SELECT 1 FROM public.blocks
    WHERE blocker_id = p_target_user_id AND blocked_id = v_caller_id
  ) THEN
    v_status := 'viewer_blocked';
  ELSIF EXISTS (
    SELECT 1 FROM public.connections
    WHERE user_a_id = LEAST(v_caller_id, p_target_user_id) 
      AND user_b_id = GREATEST(v_caller_id, p_target_user_id)
  ) THEN
    v_status := 'connected';
    
    -- Lookup existing 1:1 conversation ID
    SELECT id INTO v_conv_id
    FROM public.conversations
    WHERE user_a_id = LEAST(v_caller_id, p_target_user_id) 
      AND user_b_id = GREATEST(v_caller_id, p_target_user_id)
    LIMIT 1;
  ELSE
    -- Check outgoing pending request
    SELECT id, context INTO v_pending_req_id, v_pending_context
    FROM public.connection_requests
    WHERE sender_id = v_caller_id 
      AND recipient_id = p_target_user_id 
      AND status = 'pending'
    LIMIT 1;

    IF v_pending_req_id IS NOT NULL THEN
      v_status := 'request_sent';
    ELSE
      -- Check incoming pending request
      SELECT id, context INTO v_pending_req_id, v_pending_context
      FROM public.connection_requests
      WHERE sender_id = p_target_user_id 
        AND recipient_id = v_caller_id 
        AND status = 'pending'
      LIMIT 1;

      IF v_pending_req_id IS NOT NULL THEN
        v_status := 'request_received';
      ELSE
        v_status := 'not_connected';
      END IF;
    END IF;
  END IF;

  -- 4. Build sanitized response (Never expose private emails or auth records)
  SELECT jsonb_build_object(
    'id', v_profile.id,
    'username', v_profile.username,
    'normalized_username', v_profile.normalized_username,
    'display_name', v_profile.display_name,
    'avatar_url', v_profile.avatar_url,
    'bio', CASE WHEN v_status = 'viewer_blocked' THEN NULL ELSE v_profile.bio END,
    'created_at', v_profile.created_at,
    'relationship', jsonb_build_object(
      'status', v_status,
      'pending_request_id', v_pending_req_id,
      'request_context', v_pending_context,
      'conversation_id', v_conv_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Restrict RPC execution to authenticated users only
REVOKE ALL ON FUNCTION public.get_other_user_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_other_user_profile(UUID) TO authenticated;
