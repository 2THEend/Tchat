-- ==============================================================================
-- Tchat: Feed Domain Migration — Phase 1 (Minimal Ephemeral Discovery)
-- Migration: 20261003140000_create_tchat_feed_posts.sql
-- Description: Creates public.feed_posts with 24-hour expiration, RLS policies,
--              create_feed_post RPC, and get_active_feed_posts RPC.
-- ==============================================================================

-- 1. Create Feed Posts Table
CREATE TABLE IF NOT EXISTS public.feed_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(trim(content)) >= 1 AND char_length(content) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_feed_posts_author ON public.feed_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_feed_posts_expires_at ON public.feed_posts(expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_posts_created_at ON public.feed_posts(created_at DESC);

-- 2. Enable Row Level Security
ALTER TABLE public.feed_posts ENABLE ROW LEVEL SECURITY;

-- 2.1 SELECT Policy: Active posts only, excluding blocked pairs
DROP POLICY IF EXISTS "Authenticated users can view active unblocked feed posts" ON public.feed_posts;
CREATE POLICY "Authenticated users can view active unblocked feed posts"
  ON public.feed_posts
  FOR SELECT
  TO authenticated
  USING (
    expires_at > now()
    AND NOT public.are_users_blocked(author_id, auth.uid())
  );

-- 2.2 INSERT Policy: Authors can only create posts for themselves
DROP POLICY IF EXISTS "Authenticated users can create own feed posts" ON public.feed_posts;
CREATE POLICY "Authenticated users can create own feed posts"
  ON public.feed_posts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND expires_at > now()
  );

-- 2.3 DELETE Policy: Authors can delete their own posts
DROP POLICY IF EXISTS "Authors can delete own feed posts" ON public.feed_posts;
CREATE POLICY "Authors can delete own feed posts"
  ON public.feed_posts
  FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()
  );

-- 3. Stored Procedure: create_feed_post
CREATE OR REPLACE FUNCTION public.create_feed_post(p_content TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_author_id UUID;
  v_clean_content TEXT;
  v_post_id UUID;
BEGIN
  v_author_id := auth.uid();
  IF v_author_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_clean_content := trim(p_content);
  IF v_clean_content IS NULL OR char_length(v_clean_content) < 1 THEN
    RAISE EXCEPTION 'Post content cannot be empty.';
  END IF;

  IF char_length(p_content) > 500 THEN
    RAISE EXCEPTION 'Post content cannot exceed 500 characters.';
  END IF;

  INSERT INTO public.feed_posts (
    author_id,
    content,
    created_at,
    expires_at
  ) VALUES (
    v_author_id,
    v_clean_content,
    now(),
    now() + interval '24 hours'
  ) RETURNING id INTO v_post_id;

  RETURN v_post_id;
END;
$$;

-- 4. Stored Procedure: get_active_feed_posts
CREATE OR REPLACE FUNCTION public.get_active_feed_posts()
RETURNS TABLE (
  id UUID,
  author_id UUID,
  content TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  author_username TEXT,
  author_display_name TEXT,
  author_avatar_url TEXT
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
    fp.id,
    fp.author_id,
    fp.content,
    fp.created_at,
    fp.expires_at,
    p.username AS author_username,
    p.display_name AS author_display_name,
    p.avatar_url AS author_avatar_url
  FROM public.feed_posts fp
  JOIN public.profiles p ON p.id = fp.author_id
  WHERE fp.expires_at > now()
    AND NOT public.are_users_blocked(fp.author_id, v_caller_id)
  ORDER BY fp.created_at DESC;
END;
$$;

-- 5. Permissions
REVOKE ALL ON public.feed_posts FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.feed_posts TO authenticated;

REVOKE ALL ON FUNCTION public.create_feed_post(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_feed_post(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_active_feed_posts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_feed_posts() TO authenticated;
