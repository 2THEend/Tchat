/**
 * Tchat Identity Service.
 * 
 * Manages Tchat accounts and profiles against PostgreSQL/Supabase.
 * Enforces username normalization and uniqueness at application and database layers.
 */

import { supabase } from '../../lib/supabase';
import { 
  TchatProfile, 
  TchatAccount, 
  IdentitySetupInput, 
  IdentityStatus 
} from './types';
import { 
  validateUsername, 
  validateDisplayName, 
  validateBio, 
  normalizeUsername 
} from './validation';

export async function checkIdentity(userId: string): Promise<IdentityStatus> {
  if (!supabase) {
    return {
      isChecking: false,
      hasProfile: false,
      profile: null,
      account: null,
      error: 'Supabase client is not ready.',
    };
  }

  try {
    // 1. Fetch Profile
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      // Catch schema missing error
      if (profileError.message.includes('schema cache') || profileError.message.includes('does not exist')) {
        return {
          isChecking: false,
          hasProfile: false,
          profile: null,
          account: null,
          error: 'DATABASE_SCHEMA_PENDING',
        };
      }
      return {
        isChecking: false,
        hasProfile: false,
        profile: null,
        account: null,
        error: profileError.message,
      };
    }

    // 2. Fetch Account
    const { data: accountData } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    const hasProfile = !!profileData && !!profileData.username;

    return {
      isChecking: false,
      hasProfile,
      profile: profileData as TchatProfile | null,
      account: accountData as TchatAccount | null,
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error checking user profile.';
    return {
      isChecking: false,
      hasProfile: false,
      profile: null,
      account: null,
      error: message,
    };
  }
}

export async function isUsernameAvailable(
  rawUsername: string,
  excludeUserId?: string
): Promise<{ available: boolean; error?: string }> {
  const validation = validateUsername(rawUsername);
  if (!validation.isValid || !validation.normalized) {
    return { available: false, error: validation.error };
  }

  if (!supabase) {
    return { available: true };
  }

  try {
    let query = supabase
      .from('profiles')
      .select('id')
      .eq('normalized_username', validation.normalized);

    if (excludeUserId) {
      query = query.neq('id', excludeUserId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      // If table doesn't exist yet, we don't block
      return { available: true };
    }

    if (data) {
      return { available: false, error: `Username "@${rawUsername.trim()}" is already taken.` };
    }

    return { available: true };
  } catch {
    return { available: true };
  }
}

export async function completeIdentitySetup(
  userId: string,
  input: IdentitySetupInput,
  userEmail?: string | null
): Promise<{ success: boolean; profile?: TchatProfile; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not ready.' };
  }

  // 1. Client Validations
  const usernameVal = validateUsername(input.username);
  if (!usernameVal.isValid || !usernameVal.normalized) {
    return { success: false, error: usernameVal.error };
  }

  const nameVal = validateDisplayName(input.display_name);
  if (!nameVal.isValid) {
    return { success: false, error: nameVal.error };
  }

  const bioVal = validateBio(input.bio);
  if (!bioVal.isValid) {
    return { success: false, error: bioVal.error };
  }

  const normalized = usernameVal.normalized;
  const cleanDisplayName = input.display_name?.trim() || null;
  const cleanAvatarUrl = input.avatar_url?.trim() || null;
  const cleanBio = input.bio?.trim() || null;

  try {
    // Attempt 1: Try atomic RPC if installed in database
    const { data: rpcData, error: rpcError } = await supabase.rpc('setup_tchat_identity', {
      p_username: input.username.trim(),
      p_display_name: cleanDisplayName,
      p_avatar_url: cleanAvatarUrl,
      p_bio: cleanBio,
    });

    if (!rpcError && rpcData) {
      return { success: true, profile: rpcData as TchatProfile };
    }

    // Attempt 2: Fallback to direct client RLS insert/upsert
    // Step A: Ensure account record
    const { error: accountError } = await supabase
      .from('accounts')
      .upsert({
        id: userId,
        email: userEmail || null,
        status: 'active',
        updated_at: new Date().toISOString(),
      });

    if (accountError && !accountError.message.includes('duplicate')) {
      if (accountError.message.includes('schema cache')) {
        return { 
          success: false, 
          error: 'Database tables are not yet created. Please execute the migration file in your Supabase SQL editor.' 
        };
      }
      return { success: false, error: `Failed to create account record: ${accountError.message}` };
    }

    // Step B: Upsert profile record
    const { data: profileResult, error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        username: input.username.trim(),
        normalized_username: normalized,
        display_name: cleanDisplayName,
        avatar_url: cleanAvatarUrl,
        bio: cleanBio,
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (profileError) {
      if (profileError.code === '23505' || profileError.message.includes('unique') || profileError.message.includes('already taken')) {
        return { success: false, error: `The username "@${input.username.trim()}" is already taken. Please try another.` };
      }
      return { success: false, error: profileError.message };
    }

    return { success: true, profile: profileResult as TchatProfile };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to save identity setup.';
    return { success: false, error: message };
  }
}

/**
 * Updates a user's Tchat username.
 * 
 * Verifies that updating the username handle alters only public.profiles,
 * leaving auth.users and public.accounts untouched.
 */
export async function updateUsername(
  userId: string,
  newUsername: string
): Promise<{ success: boolean; profile?: TchatProfile; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not ready.' };
  }

  const usernameVal = validateUsername(newUsername);
  if (!usernameVal.isValid || !usernameVal.normalized) {
    return { success: false, error: usernameVal.error };
  }

  try {
    const { data: updatedProfile, error } = await supabase
      .from('profiles')
      .update({
        username: newUsername.trim(),
        normalized_username: usernameVal.normalized,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505' || error.message.includes('unique') || error.message.includes('already taken')) {
        return { success: false, error: `The username "@${newUsername.trim()}" is already taken.` };
      }
      return { success: false, error: error.message };
    }

    return { success: true, profile: updatedProfile as TchatProfile };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update username.';
    return { success: false, error: message };
  }
}

