-- ==============================================================================
-- Tchat: Conversation Archive Domain Migration
-- Migration: 20261002130000_conversation_archives.sql
-- Description: Per-user conversation archival state, RLS policies, archive/unarchive RPCs,
--              and updated get_user_conversations() returning is_archived and archived_at.
-- ==============================================================================

-- 1. Create Per-User Conversation Archives Table
CREATE TABLE IF NOT EXISTS public.conversation_archives (
  user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_archives_user ON public.conversation_archives(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_archives_conv ON public.conversation_archives(conversation_id);

-- 2. Enable Row Level Security
ALTER TABLE public.conversation_archives ENABLE ROW LEVEL SECURITY;

-- 2.1 SELECT policy: Users can only view their own archive records
DROP POLICY IF EXISTS "Users can view their own conversation archives" ON public.conversation_archives;
CREATE POLICY "Users can view their own conversation archives"
  ON public.conversation_archives
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 2.2 INSERT policy: Users can only archive their own conversations that they participate in
DROP POLICY IF EXISTS "Users can archive their own conversations" ON public.conversation_archives;
CREATE POLICY "Users can archive their own conversations"
  ON public.conversation_archives
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
    )
  );

-- 2.3 DELETE policy: Users can only unarchive their own conversations
DROP POLICY IF EXISTS "Users can unarchive their own conversations" ON public.conversation_archives;
CREATE POLICY "Users can unarchive their own conversations"
  ON public.conversation_archives
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- 3. Archive RPC Operations
-- 3.1 archive_conversation
CREATE OR REPLACE FUNCTION public.archive_conversation(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_is_participant BOOLEAN;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate caller participates in the conversation
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (c.user_a_id = v_caller_id OR c.user_b_id = v_caller_id)
  ) INTO v_is_participant;

  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'You are not a participant in this conversation.';
  END IF;

  -- Upsert into conversation_archives
  INSERT INTO public.conversation_archives (user_id, conversation_id, archived_at)
  VALUES (v_caller_id, p_conversation_id, now())
  ON CONFLICT (user_id, conversation_id)
  DO UPDATE SET archived_at = now();

  RETURN true;
END;
$$;

-- 3.2 unarchive_conversation
CREATE OR REPLACE FUNCTION public.unarchive_conversation(p_conversation_id UUID)
RETURNS BOOLEAN
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

  DELETE FROM public.conversation_archives
  WHERE user_id = v_caller_id AND conversation_id = p_conversation_id;

  RETURN true;
END;
$$;

-- 4. Update get_user_conversations() to include is_archived and archived_at
DROP FUNCTION IF EXISTS public.get_user_conversations();

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
  other_avatar_url TEXT,
  is_archived BOOLEAN,
  archived_at TIMESTAMPTZ
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
    p.avatar_url AS other_avatar_url,
    (ca.archived_at IS NOT NULL) AS is_archived,
    ca.archived_at AS archived_at
  FROM public.conversations c
  JOIN public.profiles p ON (
    p.id = CASE WHEN c.user_a_id = v_caller_id THEN c.user_b_id ELSE c.user_a_id END
  )
  LEFT JOIN public.conversation_archives ca ON (
    ca.conversation_id = c.id AND ca.user_id = v_caller_id
  )
  WHERE (c.user_a_id = v_caller_id OR c.user_b_id = v_caller_id)
    AND NOT public.are_users_blocked(c.user_a_id, c.user_b_id)
  ORDER BY c.last_activity_at DESC NULLS LAST, c.created_at DESC;
END;
$$;

-- 5. Permissions
REVOKE ALL ON public.conversation_archives FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.conversation_archives TO authenticated;

REVOKE ALL ON FUNCTION public.archive_conversation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_conversation(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.unarchive_conversation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unarchive_conversation(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_conversations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_conversations() TO authenticated;
