/**
 * Tchat Auth Service using Supabase Auth.
 * 
 * Architectural Principles:
 * - Authentication: Supabase Auth is the authoritative credential/session manager.
 * - Identity: Tchat Account (accounts) and Profile (profiles) hold application identity.
 * - Username: Strictly public discovery identifier; never used as an artificial auth email.
 * - Sign In with Username: Resolves the account's registered authentication email securely
 *   via password-verified RPC, then signs in using native Supabase Auth signInWithPassword.
 * - Password Recovery: Reset instructions are sent exclusively to the user's authentic email.
 * - Privacy: Password reset and login endpoints never reveal whether an email or username exists.
 * - Rate Limiting: Gracefully handled and communicated without crashing or faking success.
 */

import { supabase } from '../../lib/supabase';
import { AuthResponse } from './types';
import { normalizeUsername, validateUsername } from '../identity/validation';
import { validateEmail, validatePassword } from './validation';

function formatAuthError(error: { message: string; status?: number }): { error: string; isRateLimited: boolean } {
  const msg = error.message.toLowerCase();
  const status = error.status;

  if (status === 429 || msg.includes('over_email_send_rate_limit') || msg.includes('rate limit') || msg.includes('too many requests')) {
    return {
      error: 'The email service rate limit was exceeded. Please wait a few minutes before trying again.',
      isRateLimited: true,
    };
  }

  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return {
      error: 'Invalid email or password. Please check your credentials.',
      isRateLimited: false,
    };
  }

  if (msg.includes('user already registered') || msg.includes('already exists')) {
    return {
      error: 'An account with this email already exists. Try signing in instead.',
      isRateLimited: false,
    };
  }

  if (msg.includes('email not confirmed') || msg.includes('not verified')) {
    return {
      error: 'Please verify your email address before signing in. Check your inbox for the verification link.',
      isRateLimited: false,
    };
  }

  if (msg.includes('password should be at least')) {
    return {
      error: 'Password must be at least 8 characters long.',
      isRateLimited: false,
    };
  }

  return {
    error: error.message || 'An unexpected error occurred. Please try again.',
    isRateLimited: false,
  };
}

/**
 * Google OAuth sign-in.
 * Supabase handles redirect to Google authentication endpoint.
 */
export async function signInWithGoogle(): Promise<AuthResponse> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not initialized.' };
  }

  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      const formatted = formatAuthError(error);
      return { success: false, error: formatted.error, isRateLimited: formatted.isRateLimited };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to initialize Google sign in.';
    return { success: false, error: message };
  }
}

/**
 * Native Email + Password Sign In.
 */
export async function signInWithEmail(email: string, password: string): Promise<AuthResponse> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not initialized.' };
  }

  const emailVal = validateEmail(email);
  if (!emailVal.isValid) {
    return { success: false, error: emailVal.error };
  }

  if (!password) {
    return { success: false, error: 'Please enter your password.' };
  }

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      const formatted = formatAuthError(error);
      return { success: false, error: formatted.error, isRateLimited: formatted.isRateLimited };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unable to sign in. Please check your connection.';
    return { success: false, error: message };
  }
}

/**
 * Native Email + Password Sign Up.
 * Registers real Supabase Auth user and stores requested username in metadata for identity setup.
 */
export async function signUpWithEmail(
  email: string, 
  password: string,
  requestedUsername?: string
): Promise<AuthResponse> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not initialized.' };
  }

  const emailVal = validateEmail(email);
  if (!emailVal.isValid) {
    return { success: false, error: emailVal.error };
  }

  const passwordVal = validatePassword(password);
  if (!passwordVal.isValid) {
    return { success: false, error: passwordVal.error };
  }

  try {
    const options: { emailRedirectTo?: string; data?: Record<string, string> } = {
      emailRedirectTo: window.location.origin,
    };

    if (requestedUsername && requestedUsername.trim()) {
      options.data = { requested_username: requestedUsername.trim() };
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options,
    });

    if (error) {
      const formatted = formatAuthError(error);
      return { success: false, error: formatted.error, isRateLimited: formatted.isRateLimited };
    }

    // Check if email confirmation is required by Supabase project settings
    const needsEmailVerification = !data.session && !!data.user && !data.user.confirmed_at;

    return { 
      success: true, 
      needsEmailVerification 
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unable to create account. Please try again.';
    return { success: false, error: message };
  }
}

/**
 * Resends signup confirmation email.
 */
export async function resendVerificationEmail(email: string): Promise<AuthResponse> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not initialized.' };
  }

  const emailVal = validateEmail(email);
  if (!emailVal.isValid) {
    return { success: false, error: emailVal.error };
  }

  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      const formatted = formatAuthError(error);
      return { success: false, error: formatted.error, isRateLimited: formatted.isRateLimited };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to resend verification email.';
    return { success: false, error: message };
  }
}

/**
 * Initiates password reset for a given email address.
 * 
 * SECURITY INVARIANT:
 * To prevent user enumeration, we do NOT disclose whether an email exists in the system.
 * Only systemic errors (e.g. rate limits or offline network) are returned to the caller.
 */
export async function sendPasswordResetEmail(email: string): Promise<AuthResponse> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not initialized.' };
  }

  const emailVal = validateEmail(email);
  if (!emailVal.isValid) {
    return { success: false, error: emailVal.error };
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: window.location.origin,
    });

    if (error) {
      const formatted = formatAuthError(error);
      // Rate limits or system downtime must still be surfaced cleanly
      if (formatted.isRateLimited) {
        return { success: false, error: formatted.error, isRateLimited: true };
      }
      // If error is user-not-found, we suppress it to prevent email harvesting
      const msg = error.message.toLowerCase();
      if (!msg.includes('user not found') && !msg.includes('invalid email')) {
        return { success: false, error: formatted.error };
      }
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unable to send reset instructions.';
    return { success: false, error: message };
  }
}

/**
 * Updates the user's password when in an authenticated recovery session.
 */
export async function updatePassword(newPassword: string): Promise<AuthResponse> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not initialized.' };
  }

  const passwordVal = validatePassword(newPassword);
  if (!passwordVal.isValid) {
    return { success: false, error: passwordVal.error };
  }

  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      const formatted = formatAuthError(error);
      return { success: false, error: formatted.error, isRateLimited: formatted.isRateLimited };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update password.';
    return { success: false, error: message };
  }
}

/**
 * Username + Password Authentication (Sign In)
 * 
 * Secure credential resolution:
 * 1. Invokes password-verified PostgreSQL RPC get_auth_email_for_login(p_username, p_password).
 *    - If username does not exist or password is wrong: returns NULL.
 *    - Does NOT leak email addresses or username existence.
 * 2. Authenticates natively with Supabase Auth using signInWithPassword({ email, password }).
 */
export async function signInWithUsername(rawUsername: string, password: string): Promise<AuthResponse> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not initialized.' };
  }

  const normalized = normalizeUsername(rawUsername);
  if (!normalized) {
    return { success: false, error: 'Please enter your username.' };
  }
  if (!password) {
    return { success: false, error: 'Please enter your password.' };
  }

  try {
    const { data: resolvedEmail, error: rpcError } = await supabase.rpc('get_auth_email_for_login', {
      p_username: normalized,
      p_password: password,
    });

    if (rpcError || !resolvedEmail) {
      return { 
        success: false, 
        error: 'Invalid username or password. Please verify your credentials.' 
      };
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: resolvedEmail as string,
      password,
    });

    if (authError) {
      const formatted = formatAuthError(authError);
      if (formatted.isRateLimited) {
        return { success: false, error: formatted.error, isRateLimited: true };
      }
      return { 
        success: false, 
        error: 'Invalid username or password. Please verify your credentials.' 
      };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to sign in with username.';
    return { success: false, error: message };
  }
}

/**
 * Username Sign Up
 * Registers a real Supabase Auth account with recovery email, password, and requested username.
 */
export async function signUpWithUsername(
  rawUsername: string, 
  email: string,
  password: string
): Promise<AuthResponse> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not initialized.' };
  }

  // 1. Validate Username
  const userVal = validateUsername(rawUsername);
  if (!userVal.isValid) {
    return { success: false, error: userVal.error || 'Invalid username.' };
  }

  // 2. Validate Email
  const emailVal = validateEmail(email);
  if (!emailVal.isValid) {
    return { success: false, error: emailVal.error || 'A valid recovery email address is required.' };
  }

  // 3. Validate Password
  const passwordVal = validatePassword(password);
  if (!passwordVal.isValid) {
    return { success: false, error: passwordVal.error || 'Password must be at least 8 characters long.' };
  }

  // 4. Pre-check username availability in public.profiles
  try {
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('normalized_username', userVal.normalized)
      .maybeSingle();

    if (existingProfile) {
      return { success: false, error: `The username "@${rawUsername.trim()}" is already taken.` };
    }
  } catch {
    // If table cannot be queried, proceed to let database enforce
  }

  // 5. Sign up natively with Supabase Auth
  return signUpWithEmail(email.trim().toLowerCase(), password, rawUsername.trim());
}

/**
 * Sign out of current Supabase session.
 */
export async function signOut(): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: true };
  }

  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error signing out.';
    return { success: false, error: message };
  }
}
