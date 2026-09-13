-- ==============================================================================
-- Tchat: Authentication & Identity Domain Migration
-- Migration: 20260913000000_create_tchat_accounts_and_profiles.sql
-- Description: Establishes application-level Accounts and public Profiles tables
--              with strict constraints, normalization, and Row Level Security (RLS).
-- ==============================================================================

-- 1. Ensure required extensions exist in extensions schema
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Create Accounts Table (Application-level account linked to auth.users)
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
  email TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Create Profiles Table (Public/user-facing identity)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  normalized_username TEXT NOT NULL,
  display_name TEXT NULL,
  avatar_url TEXT NULL,
  bio TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Username constraints: 3-24 chars, letters, digits, underscores
  CONSTRAINT valid_username CHECK (
    username ~ '^[a-zA-Z0-9_]{3,24}$' AND
    normalized_username = lower(trim(username))
  ),
  CONSTRAINT valid_display_name CHECK (
    display_name IS NULL OR char_length(display_name) <= 50
  ),
  CONSTRAINT valid_bio CHECK (
    bio IS NULL OR char_length(bio) <= 200
  )
);

-- 4. Unique & Search Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_normalized_username 
  ON public.profiles(normalized_username);

CREATE INDEX IF NOT EXISTS idx_accounts_email
  ON public.accounts(lower(email))
  WHERE email IS NOT NULL;

-- 5. Enable Row Level Security
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for Accounts (Strict private access)
-- Users can read their own account record only
DROP POLICY IF EXISTS "Users can read own account" ON public.accounts;
CREATE POLICY "Users can read own account" 
  ON public.accounts 
  FOR SELECT 
  TO authenticated 
  USING (auth.uid() = id);

-- Users can insert their own account record upon authentication
DROP POLICY IF EXISTS "Users can insert own account" ON public.accounts;
CREATE POLICY "Users can insert own account" 
  ON public.accounts 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (auth.uid() = id);

-- Users can update their own account record only
DROP POLICY IF EXISTS "Users can update own account" ON public.accounts;
CREATE POLICY "Users can update own account" 
  ON public.accounts 
  FOR UPDATE 
  TO authenticated 
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 7. RLS Policies for Profiles
-- Public profiles are viewable by everyone (for discovery and identity resolution)
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles are viewable by everyone" 
  ON public.profiles 
  FOR SELECT 
  USING (true);

-- Authenticated users can insert their own profile with matching auth.uid()
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" 
  ON public.profiles 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (auth.uid() = id);

-- Authenticated users can update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
  ON public.profiles 
  FOR UPDATE 
  TO authenticated 
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 8. Trigger on auth.users to synchronize Tchat account creation
-- Runs with SECURITY DEFINER and constrained search_path.
-- Only triggers on internal auth.users INSERT or email UPDATE.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.accounts (id, email, status, created_at, updated_at)
  VALUES (new.id, new.email, 'active', now(), now())
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- Restrict direct execution of trigger function
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

-- 9. Secure Username Sign-In Credential Resolution
-- SECURITY MODEL:
-- - The RPC NEVER exposes an authentication email to arbitrary callers.
-- - Callers MUST supply both the username handle and the account password.
-- - The function verifies the password against auth.users.encrypted_password using bcrypt.
-- - If the username does NOT exist: executes a dummy hash to prevent timing attacks, returns NULL.
-- - If the password is WRONG: returns NULL.
-- - If the password is CORRECT: returns the registered auth email, enabling the client
--   to exchange credentials with Supabase Auth for an official session token.
-- - Both non-existent users and wrong passwords return NULL, preventing user enumeration.
CREATE OR REPLACE FUNCTION public.get_auth_email_for_login(
  p_username TEXT,
  p_password TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_norm_username TEXT;
  v_user_id UUID;
  v_encrypted_password TEXT;
  v_email TEXT;
BEGIN
  v_norm_username := lower(trim(p_username));
  IF v_norm_username IS NULL OR v_norm_username = '' OR p_password IS NULL OR p_password = '' THEN
    RETURN NULL;
  END IF;

  -- 1. Resolve user ID from public profile
  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE normalized_username = v_norm_username
  LIMIT 1;

  -- 2. If user not found, perform dummy crypt calculation to prevent timing disparity
  IF v_user_id IS NULL THEN
    PERFORM extensions.crypt(p_password, '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUUabcdefghijk');
    RETURN NULL;
  END IF;

  -- 3. Retrieve stored password hash and registered email from auth.users
  SELECT u.encrypted_password, u.email INTO v_encrypted_password, v_email
  FROM auth.users u
  WHERE u.id = v_user_id;

  IF v_encrypted_password IS NULL OR v_email IS NULL THEN
    RETURN NULL;
  END IF;

  -- 4. Verify password against bcrypt hash using pgcrypto crypt
  IF extensions.crypt(p_password, v_encrypted_password) = v_encrypted_password THEN
    RETURN v_email;
  ELSE
    RETURN NULL;
  END IF;
END;
$$;

-- Grant execution to anon and authenticated for login resolution
REVOKE ALL ON FUNCTION public.get_auth_email_for_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_auth_email_for_login(TEXT, TEXT) TO anon, authenticated;

-- Drop legacy 1-argument signature if it was previously created
DROP FUNCTION IF EXISTS public.get_auth_email_for_login(TEXT);

-- 10. Atomic Identity Setup Function (Transactional creation/updating)
CREATE OR REPLACE FUNCTION public.setup_tchat_identity(
  p_username TEXT,
  p_display_name TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL,
  p_bio TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
  v_norm_username TEXT;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_norm_username := lower(trim(p_username));

  -- Validate username format
  IF NOT (p_username ~ '^[a-zA-Z0-9_]{3,24}$') THEN
    RAISE EXCEPTION 'Invalid username format. Must be 3-24 characters containing letters, numbers, or underscores.';
  END IF;

  -- Check if username is taken by a different user
  IF EXISTS (SELECT 1 FROM public.profiles WHERE normalized_username = v_norm_username AND id <> v_user_id) THEN
    RAISE EXCEPTION 'Username "%" is already taken.', p_username;
  END IF;

  -- Get email from auth.users
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- Ensure account record exists
  INSERT INTO public.accounts (id, email, status, updated_at)
  VALUES (v_user_id, v_user_email, 'active', now())
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, updated_at = now();

  -- Insert or update profile record
  INSERT INTO public.profiles (
    id,
    username,
    normalized_username,
    display_name,
    avatar_url,
    bio,
    updated_at
  )
  VALUES (
    v_user_id,
    p_username,
    v_norm_username,
    p_display_name,
    p_avatar_url,
    p_bio,
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET 
    username = EXCLUDED.username,
    normalized_username = EXCLUDED.normalized_username,
    display_name = EXCLUDED.display_name,
    avatar_url = EXCLUDED.avatar_url,
    bio = EXCLUDED.bio,
    updated_at = now();

  SELECT jsonb_build_object(
    'id', id,
    'username', username,
    'normalized_username', normalized_username,
    'display_name', display_name,
    'avatar_url', avatar_url,
    'bio', bio
  ) INTO v_result
  FROM public.profiles
  WHERE id = v_user_id;

  RETURN v_result;
END;
$$;

-- Restrict setup_tchat_identity to authenticated users only
REVOKE ALL ON FUNCTION public.setup_tchat_identity(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.setup_tchat_identity(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 11. Explicit Table Permissions Lockdown
REVOKE ALL ON public.accounts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.accounts TO authenticated;

GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;
