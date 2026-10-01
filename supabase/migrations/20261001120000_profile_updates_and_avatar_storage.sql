-- ==============================================================================
-- Tchat: Profile Domain Maturity & Avatar Storage Migration
-- Migration: 20261001120000_profile_updates_and_avatar_storage.sql
-- Description: Sets up native avatar storage bucket, storage RLS policies,
--              and atomic update_own_profile RPC function.
-- ==============================================================================

-- 1. Create Public Supabase Storage Bucket for Profile Avatars
-- Avatars are public identity assets viewable across the app (search, conversations, groups, connections)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880, -- 5MB maximum upload limit
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif'
  ];

-- 2. Storage RLS Policies for Avatars
-- 2.1 Anyone (anon and authenticated) can view/read avatars
DROP POLICY IF EXISTS "Public can view profile avatars" ON storage.objects;
CREATE POLICY "Public can view profile avatars"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

-- 2.2 Authenticated users can upload avatars only into their own folder (avatars/<user_id>/...)
DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
CREATE POLICY "Users can upload own avatar"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2.3 Authenticated users can update avatars only in their own folder
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
CREATE POLICY "Users can update own avatar"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars' AND
    (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2.4 Authenticated users can delete avatars only in their own folder
DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;
CREATE POLICY "Users can delete own avatar"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3. Atomic Profile Update RPC Function
-- Strictly derives user from auth.uid() to prevent modifying another user's profile
CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_username TEXT,
  p_display_name TEXT DEFAULT NULL,
  p_bio TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_norm_username TEXT;
  v_clean_username TEXT;
  v_clean_display_name TEXT;
  v_clean_bio TEXT;
  v_clean_avatar_url TEXT;
  v_result JSONB;
BEGIN
  -- 1. Authentication check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Ensure account exists and is active
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = v_user_id AND status = 'active') THEN
    RAISE EXCEPTION 'Account is not active or does not exist.';
  END IF;

  -- 3. Clean and sanitize inputs
  v_clean_username := trim(p_username);
  IF v_clean_username LIKE '@%' THEN
    v_clean_username := substr(v_clean_username, 2);
  END IF;

  v_norm_username := lower(v_clean_username);
  v_clean_display_name := NULLIF(trim(p_display_name), '');
  v_clean_bio := NULLIF(trim(p_bio), '');
  v_clean_avatar_url := NULLIF(trim(p_avatar_url), '');

  -- 4. Server-side validations
  -- Username format: 3-24 characters, letters, digits, underscores
  IF v_clean_username IS NULL OR NOT (v_clean_username ~ '^[a-zA-Z0-9_]{3,24}$') THEN
    RAISE EXCEPTION 'Invalid username format. Must be 3-24 characters containing letters, numbers, or underscores.';
  END IF;

  -- Display name length: max 50 characters
  IF v_clean_display_name IS NOT NULL AND char_length(v_clean_display_name) > 50 THEN
    RAISE EXCEPTION 'Display name cannot exceed 50 characters.';
  END IF;

  -- Bio length: max 200 characters
  IF v_clean_bio IS NOT NULL AND char_length(v_clean_bio) > 200 THEN
    RAISE EXCEPTION 'Bio cannot exceed 200 characters.';
  END IF;

  -- 5. Uniqueness validation: check if username is claimed by another user
  IF EXISTS (
    SELECT 1 
    FROM public.profiles 
    WHERE normalized_username = v_norm_username 
      AND id <> v_user_id
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken.', v_clean_username;
  END IF;

  -- 6. Perform the atomic update
  UPDATE public.profiles
  SET
    username = v_clean_username,
    normalized_username = v_norm_username,
    display_name = v_clean_display_name,
    bio = v_clean_bio,
    avatar_url = v_clean_avatar_url,
    updated_at = now()
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  -- 7. Build and return updated profile record
  SELECT jsonb_build_object(
    'id', id,
    'username', username,
    'normalized_username', normalized_username,
    'display_name', display_name,
    'avatar_url', avatar_url,
    'bio', bio,
    'created_at', created_at,
    'updated_at', updated_at
  ) INTO v_result
  FROM public.profiles
  WHERE id = v_user_id;

  RETURN v_result;
END;
$$;

-- Restrict RPC execution to authenticated users only
REVOKE ALL ON FUNCTION public.update_own_profile(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_own_profile(TEXT, TEXT, TEXT, TEXT) TO authenticated;
