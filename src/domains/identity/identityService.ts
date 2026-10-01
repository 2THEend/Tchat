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
  IdentityStatus,
  UpdateProfileInput,
  OtherUserProfile 
} from './types';
import { 
  validateUsername, 
  validateDisplayName, 
  validateBio, 
  normalizeUsername,
  validateAvatarFile 
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

/**
 * Updates the authenticated user's own profile.
 * 
 * Uses server-side RPC update_own_profile which derives user identity
 * authoritatively from auth.uid(). Validates fields, enforces username
 * format and uniqueness, and preserves account/profile consistency.
 */
export async function updateOwnProfile(
  input: UpdateProfileInput
): Promise<{ success: boolean; profile?: TchatProfile; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not ready.' };
  }

  // 1. Client-side input validation
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

  const cleanDisplayName = input.display_name?.trim() || null;
  const cleanBio = input.bio?.trim() || null;
  const cleanAvatarUrl = input.avatar_url?.trim() || null;

  try {
    // 2. Primary: Invoke server-authoritative RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc('update_own_profile', {
      p_username: input.username.trim(),
      p_display_name: cleanDisplayName,
      p_bio: cleanBio,
      p_avatar_url: cleanAvatarUrl,
    });

    if (!rpcError && rpcData) {
      return { success: true, profile: rpcData as TchatProfile };
    }

    if (rpcError) {
      // Check for uniqueness conflict
      if (rpcError.message.includes('already taken') || rpcError.code === '23505') {
        return { 
          success: false, 
          error: `The username "@${input.username.trim()}" is already taken. Please choose another.` 
        };
      }

      // If function doesn't exist yet, fallback to direct RLS update
      if (!rpcError.message.includes('does not exist') && !rpcError.message.includes('function')) {
        return { success: false, error: rpcError.message };
      }
    }

    // 3. Fallback: Direct RLS update using session auth.uid()
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUserId = sessionData?.session?.user?.id;
    if (!currentUserId) {
      return { success: false, error: 'User is not authenticated.' };
    }

    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update({
        username: input.username.trim(),
        normalized_username: usernameVal.normalized,
        display_name: cleanDisplayName,
        bio: cleanBio,
        avatar_url: cleanAvatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', currentUserId)
      .select('*')
      .single();

    if (updateError) {
      if (updateError.code === '23505' || updateError.message.includes('unique') || updateError.message.includes('already taken')) {
        return { 
          success: false, 
          error: `The username "@${input.username.trim()}" is already taken.` 
        };
      }
      return { success: false, error: updateError.message };
    }

    return { success: true, profile: updatedProfile as TchatProfile };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update profile.';
    return { success: false, error: message };
  }
}

/**
 * Uploads a profile avatar image to the public 'avatars' storage bucket.
 * 
 * Enforces image validation (<= 5MB, jpeg/png/webp/gif) and stores the file
 * under an isolated user path: `${userId}/avatar-${timestamp}.${ext}`.
 */
export async function uploadAvatar(
  file: File,
  userId: string
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not ready.' };
  }

  // 1. Client validation
  const validation = validateAvatarFile(file);
  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  try {
    // 2. Derive file extension safely
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const cleanExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
    const filePath = `${userId}/avatar-${Date.now()}.${cleanExt}`;

    // 3. Upload to 'avatars' bucket
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      return { success: false, error: uploadError.message };
    }

    // 4. Retrieve permanent public URL
    const { data: publicData } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    if (!publicData || !publicData.publicUrl) {
      return { success: false, error: 'Failed to retrieve avatar public URL.' };
    }

    return { success: true, publicUrl: publicData.publicUrl };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to upload avatar image.';
    return { success: false, error: message };
  }
}

/**
 * Removes an existing avatar from storage if it is hosted in the avatars bucket.
 */
export async function deleteAvatar(
  avatarUrl: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase || !avatarUrl) {
    return { success: true };
  }

  try {
    // Check if the avatar is hosted on our Supabase avatars storage
    const avatarBucketToken = '/storage/v1/object/public/avatars/';
    const index = avatarUrl.indexOf(avatarBucketToken);
    if (index !== -1) {
      const relativePath = decodeURIComponent(avatarUrl.slice(index + avatarBucketToken.length));
      // Only delete if it belongs to this user
      if (relativePath.startsWith(`${userId}/`)) {
        await supabase.storage.from('avatars').remove([relativePath]);
      }
    }
    return { success: true };
  } catch {
    // Failing to delete old file should not block profile save
    return { success: true };
  }
}

/**
 * Retrieves the public profile and authoritative relationship context
 * for another Tchat user.
 */
export async function getOtherUserProfile(
  targetUserId: string,
  currentUserId: string
): Promise<{ data?: OtherUserProfile; error?: string }> {
  if (!supabase) {
    return { error: 'Supabase client is not ready.' };
  }

  try {
    // 1. Primary: Server-authoritative RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_other_user_profile', {
      p_target_user_id: targetUserId,
    });

    if (!rpcError && rpcData) {
      return { data: rpcData as OtherUserProfile };
    }

    // If RPC failed due to user not found or inactive account
    if (rpcError && (rpcError.message.includes('not found') || rpcError.message.includes('not available'))) {
      return { error: rpcError.message };
    }

    // 2. Fallback: Query public profile and tables directly
    const { data: profile, error: profError } = await supabase
      .from('profiles')
      .select('id, username, normalized_username, display_name, avatar_url, bio, created_at')
      .eq('id', targetUserId)
      .maybeSingle();

    if (profError || !profile) {
      return { error: profError?.message || 'User profile not found.' };
    }

    // Self check
    if (currentUserId === targetUserId) {
      return {
        data: {
          ...profile,
          relationship: {
            status: 'self',
          },
        },
      };
    }

    // Check blocks
    const { data: blockerRow } = await supabase
      .from('blocks')
      .select('id')
      .eq('blocker_id', currentUserId)
      .eq('blocked_id', targetUserId)
      .maybeSingle();

    if (blockerRow) {
      return {
        data: {
          ...profile,
          relationship: {
            status: 'blocked',
          },
        },
      };
    }

    const { data: blockedRow } = await supabase
      .from('blocks')
      .select('id')
      .eq('blocker_id', targetUserId)
      .eq('blocked_id', currentUserId)
      .maybeSingle();

    if (blockedRow) {
      return {
        data: {
          ...profile,
          bio: null, // Redacted
          relationship: {
            status: 'viewer_blocked',
          },
        },
      };
    }

    // Check connection
    const userLow = currentUserId < targetUserId ? currentUserId : targetUserId;
    const userHigh = currentUserId < targetUserId ? targetUserId : currentUserId;

    const { data: connection } = await supabase
      .from('connections')
      .select('id')
      .eq('user_a_id', userLow)
      .eq('user_b_id', userHigh)
      .maybeSingle();

    if (connection) {
      // Lookup conversation
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('user_a_id', userLow)
        .eq('user_b_id', userHigh)
        .maybeSingle();

      return {
        data: {
          ...profile,
          relationship: {
            status: 'connected',
            conversation_id: conv?.id || null,
          },
        },
      };
    }

    // Check outgoing pending request
    const { data: sentReq } = await supabase
      .from('connection_requests')
      .select('id, context')
      .eq('sender_id', currentUserId)
      .eq('recipient_id', targetUserId)
      .eq('status', 'pending')
      .maybeSingle();

    if (sentReq) {
      return {
        data: {
          ...profile,
          relationship: {
            status: 'request_sent',
            pending_request_id: sentReq.id,
            request_context: sentReq.context,
          },
        },
      };
    }

    // Check incoming pending request
    const { data: incomingReq } = await supabase
      .from('connection_requests')
      .select('id, context')
      .eq('sender_id', targetUserId)
      .eq('recipient_id', currentUserId)
      .eq('status', 'pending')
      .maybeSingle();

    if (incomingReq) {
      return {
        data: {
          ...profile,
          relationship: {
            status: 'request_received',
            pending_request_id: incomingReq.id,
            request_context: incomingReq.context,
          },
        },
      };
    }

    // Otherwise not connected
    return {
      data: {
        ...profile,
        relationship: {
          status: 'not_connected',
        },
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error fetching user profile.';
    return { error: message };
  }
}



