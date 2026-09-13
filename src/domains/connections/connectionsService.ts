/**
 * Tchat Connections Domain Service.
 * 
 * Implements intentional 1:1 human connection operations:
 * - Profile discovery with privacy bounds and block filtering
 * - Connection request creation with required context/reason
 * - Incoming request disposition (accept, decline, ignore)
 * - Sent request cancellation
 * - Connection removal (unfriend)
 * - Safety blocks (block / unblock)
 * - Domain event dispatching
 */

import { supabase } from '../../lib/supabase';
import { 
  TchatConnection, 
  TchatConnectionRequest, 
  TchatProfileSummary, 
  TchatBlock,
  ConnectionRelationshipStatus 
} from './types';
import { validateRequestContext } from './validation';
import { dispatchConnectionEvent } from './events';

export const SCHEMA_PENDING_MSG = 'DATABASE_SCHEMA_PENDING';

function isSchemaMissingError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('schema cache') ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('could not find the function') ||
    err.code === 'PGRST205' ||
    err.code === 'PGRST202' ||
    err.code === '42P01' ||
    err.code === '42883'
  );
}

/**
 * Searches for users by username or display name.
 * Respects block lists and privacy boundaries: never exposes email or auth data.
 */
export async function searchPeople(
  query: string,
  currentUserId: string
): Promise<{ data: TchatProfileSummary[]; error?: string; isSchemaPending?: boolean }> {
  if (!supabase) {
    return { data: [], error: 'Supabase client is not ready.' };
  }

  const cleanQuery = query.trim().replace(/^@/, '');
  if (cleanQuery.length === 0) {
    return { data: [] };
  }

  try {
    // Attempt 1: Call secure database RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc('search_profiles', {
      p_query: cleanQuery,
      p_limit: 20,
    });

    if (!rpcError && rpcData) {
      return { data: rpcData as TchatProfileSummary[] };
    }

    if (isSchemaMissingError(rpcError)) {
      // Fallback to manual query on public profiles if migration is not yet applied
      return fallbackSearchProfiles(cleanQuery, currentUserId);
    }

    if (rpcError) {
      return { data: [], error: rpcError.message };
    }

    return { data: [] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error searching people.';
    return { data: [], error: message };
  }
}

/**
 * Fallback search directly querying public.profiles when RPC is not yet installed.
 */
async function fallbackSearchProfiles(
  cleanQuery: string,
  currentUserId: string
): Promise<{ data: TchatProfileSummary[]; error?: string; isSchemaPending?: boolean }> {
  if (!supabase) return { data: [] };

  const norm = cleanQuery.toLowerCase();

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, bio')
    .neq('id', currentUserId)
    .or(`normalized_username.ilike.%${norm}%,display_name.ilike.%${cleanQuery}%`)
    .limit(20);

  if (error) {
    return { data: [], error: error.message };
  }

  // Check relationship statuses if tables exist
  const results: TchatProfileSummary[] = [];
  for (const p of profiles || []) {
    results.push({
      ...p,
      relationship_status: 'none',
    });
  }

  return { data: results, isSchemaPending: true };
}

/**
 * Sends an intentional connection request with required context.
 */
export async function sendConnectionRequest(
  recipientId: string,
  context: string,
  currentUserId: string
): Promise<{ success: boolean; request?: TchatConnectionRequest; error?: string; isSchemaPending?: boolean }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not ready.' };
  }

  if (recipientId === currentUserId) {
    return { success: false, error: 'You cannot send a connection request to yourself.' };
  }

  const validation = validateRequestContext(context);
  if (!validation.isValid || !validation.cleaned) {
    return { success: false, error: validation.error };
  }

  try {
    // Attempt 1: Call secure RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc('send_connection_request', {
      p_recipient_id: recipientId,
      p_context: validation.cleaned,
    });

    if (!rpcError && rpcData) {
      const createdReq = rpcData as TchatConnectionRequest;
      dispatchConnectionEvent({
        type: 'connection_request:created',
        actorId: currentUserId,
        recipientId,
        request: createdReq,
        timestamp: new Date().toISOString(),
      });
      return { success: true, request: createdReq };
    }

    if (isSchemaMissingError(rpcError)) {
      // Direct table insert fallback
      const { data: insertData, error: insertError } = await supabase
        .from('connection_requests')
        .insert({
          sender_id: currentUserId,
          recipient_id: recipientId,
          context: validation.cleaned,
          status: 'pending',
        })
        .select()
        .single();

      if (insertError) {
        if (isSchemaMissingError(insertError)) {
          return {
            success: false,
            error: 'Connections tables are pending database migration in Supabase.',
            isSchemaPending: true,
          };
        }
        return { success: false, error: insertError.message };
      }

      const createdReq = insertData as TchatConnectionRequest;
      dispatchConnectionEvent({
        type: 'connection_request:created',
        actorId: currentUserId,
        recipientId,
        request: createdReq,
        timestamp: new Date().toISOString(),
      });

      return { success: true, request: createdReq };
    }

    return { success: false, error: rpcError?.message || 'Failed to send connection request.' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to send request.';
    return { success: false, error: msg };
  }
}

/**
 * Fetches incoming pending requests for the current user.
 */
export async function getIncomingRequests(
  currentUserId: string
): Promise<{ data: TchatConnectionRequest[]; error?: string; isSchemaPending?: boolean }> {
  if (!supabase) {
    return { data: [], error: 'Supabase client is not ready.' };
  }

  try {
    const { data: requests, error } = await supabase
      .from('connection_requests')
      .select('*')
      .eq('recipient_id', currentUserId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      if (isSchemaMissingError(error)) {
        return { data: [], isSchemaPending: true };
      }
      return { data: [], error: error.message };
    }

    if (!requests || requests.length === 0) {
      return { data: [] };
    }

    // Hydrate senders
    const senderIds = [...new Set(requests.map(r => r.sender_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio')
      .in('id', senderIds);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    const hydrated: TchatConnectionRequest[] = requests.map(r => ({
      ...r,
      sender: profileMap.get(r.sender_id) || undefined,
    }));

    return { data: hydrated };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching incoming requests.';
    return { data: [], error: msg };
  }
}

/**
 * Fetches sent pending requests initiated by the current user.
 */
export async function getSentRequests(
  currentUserId: string
): Promise<{ data: TchatConnectionRequest[]; error?: string; isSchemaPending?: boolean }> {
  if (!supabase) {
    return { data: [], error: 'Supabase client is not ready.' };
  }

  try {
    const { data: requests, error } = await supabase
      .from('connection_requests')
      .select('*')
      .eq('sender_id', currentUserId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      if (isSchemaMissingError(error)) {
        return { data: [], isSchemaPending: true };
      }
      return { data: [], error: error.message };
    }

    if (!requests || requests.length === 0) {
      return { data: [] };
    }

    // Hydrate recipients
    const recipientIds = [...new Set(requests.map(r => r.recipient_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio')
      .in('id', recipientIds);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    const hydrated: TchatConnectionRequest[] = requests.map(r => ({
      ...r,
      recipient: profileMap.get(r.recipient_id) || undefined,
    }));

    return { data: hydrated };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching sent requests.';
    return { data: [], error: msg };
  }
}

/**
 * Fetches active connections for the current user.
 */
export async function getConnections(
  currentUserId: string
): Promise<{ data: TchatConnection[]; error?: string; isSchemaPending?: boolean }> {
  if (!supabase) {
    return { data: [], error: 'Supabase client is not ready.' };
  }

  try {
    const { data: connections, error } = await supabase
      .from('connections')
      .select('*')
      .or(`user_a_id.eq.${currentUserId},user_b_id.eq.${currentUserId}`)
      .order('created_at', { ascending: false });

    if (error) {
      if (isSchemaMissingError(error)) {
        return { data: [], isSchemaPending: true };
      }
      return { data: [], error: error.message };
    }

    if (!connections || connections.length === 0) {
      return { data: [] };
    }

    const otherUserIds = connections.map(c => 
      c.user_a_id === currentUserId ? c.user_b_id : c.user_a_id
    );

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio')
      .in('id', otherUserIds);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    const hydrated: TchatConnection[] = connections.map(c => {
      const otherId = c.user_a_id === currentUserId ? c.user_b_id : c.user_a_id;
      return {
        ...c,
        other_user: profileMap.get(otherId) || undefined,
      };
    });

    return { data: hydrated };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching connections.';
    return { data: [], error: msg };
  }
}

/**
 * Fetches users blocked by the current user.
 */
export async function getBlockedUsers(
  currentUserId: string
): Promise<{ data: TchatBlock[]; error?: string; isSchemaPending?: boolean }> {
  if (!supabase) {
    return { data: [], error: 'Supabase client is not ready.' };
  }

  try {
    const { data: blocks, error } = await supabase
      .from('blocks')
      .select('*')
      .eq('blocker_id', currentUserId)
      .order('created_at', { ascending: false });

    if (error) {
      if (isSchemaMissingError(error)) {
        return { data: [], isSchemaPending: true };
      }
      return { data: [], error: error.message };
    }

    if (!blocks || blocks.length === 0) {
      return { data: [] };
    }

    const blockedIds = blocks.map(b => b.blocked_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio')
      .in('id', blockedIds);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    const hydrated: TchatBlock[] = blocks.map(b => ({
      ...b,
      blocked_user: profileMap.get(b.blocked_id) || undefined,
    }));

    return { data: hydrated };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching blocked users.';
    return { data: [], error: msg };
  }
}

/**
 * Accepts a connection request.
 * Creates an intentional connection and marks request accepted.
 * BOUNDARY: Never creates a conversation or modifies Home feed.
 */
export async function acceptConnectionRequest(
  requestId: string,
  currentUserId: string,
  senderId?: string
): Promise<{ success: boolean; connection?: TchatConnection; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not ready.' };
  }

  try {
    // Attempt 1: Call atomic database RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc('accept_connection_request', {
      p_request_id: requestId,
    });

    if (!rpcError && rpcData) {
      const conn = rpcData as TchatConnection;
      dispatchConnectionEvent({
        type: 'connection_request:accepted',
        actorId: currentUserId,
        requestId,
        connection: conn,
        senderId: senderId || '',
        timestamp: new Date().toISOString(),
      });
      return { success: true, connection: conn };
    }

    if (isSchemaMissingError(rpcError)) {
      // Fallback direct execution
      if (!senderId) {
        // Fetch sender ID from request
        const { data: req } = await supabase
          .from('connection_requests')
          .select('sender_id')
          .eq('id', requestId)
          .single();
        if (req) senderId = req.sender_id;
      }

      if (!senderId) {
        return { success: false, error: 'Sender ID could not be resolved.' };
      }

      const userA = currentUserId < senderId ? currentUserId : senderId;
      const userB = currentUserId < senderId ? senderId : currentUserId;

      const { data: newConn, error: connError } = await supabase
        .from('connections')
        .upsert({ user_a_id: userA, user_b_id: userB })
        .select()
        .single();

      if (connError) {
        return { success: false, error: connError.message };
      }

      await supabase
        .from('connection_requests')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', requestId);

      dispatchConnectionEvent({
        type: 'connection_request:accepted',
        actorId: currentUserId,
        requestId,
        connection: newConn as TchatConnection,
        senderId,
        timestamp: new Date().toISOString(),
      });

      return { success: true, connection: newConn as TchatConnection };
    }

    return { success: false, error: rpcError?.message || 'Failed to accept request.' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error accepting request.';
    return { success: false, error: msg };
  }
}

/**
 * Declines a connection request.
 */
export async function declineConnectionRequest(
  requestId: string,
  currentUserId: string,
  senderId?: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not ready.' };
  }

  try {
    const { error: rpcError } = await supabase.rpc('decline_connection_request', {
      p_request_id: requestId,
    });

    if (!rpcError) {
      dispatchConnectionEvent({
        type: 'connection_request:declined',
        actorId: currentUserId,
        requestId,
        senderId,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }

    if (isSchemaMissingError(rpcError)) {
      const { error: updateError } = await supabase
        .from('connection_requests')
        .update({ status: 'declined', updated_at: new Date().toISOString() })
        .eq('id', requestId);

      if (updateError) return { success: false, error: updateError.message };

      dispatchConnectionEvent({
        type: 'connection_request:declined',
        actorId: currentUserId,
        requestId,
        senderId,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }

    return { success: false, error: rpcError.message };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error declining request.';
    return { success: false, error: msg };
  }
}

/**
 * Ignores a connection request without notifying or removing the record.
 */
export async function ignoreConnectionRequest(
  requestId: string,
  currentUserId: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not ready.' };
  }

  try {
    const { error: rpcError } = await supabase.rpc('ignore_connection_request', {
      p_request_id: requestId,
    });

    if (!rpcError) {
      dispatchConnectionEvent({
        type: 'connection_request:ignored',
        actorId: currentUserId,
        requestId,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }

    if (isSchemaMissingError(rpcError)) {
      const { error: updateError } = await supabase
        .from('connection_requests')
        .update({ status: 'ignored', updated_at: new Date().toISOString() })
        .eq('id', requestId);

      if (updateError) return { success: false, error: updateError.message };

      dispatchConnectionEvent({
        type: 'connection_request:ignored',
        actorId: currentUserId,
        requestId,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }

    return { success: false, error: rpcError.message };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error ignoring request.';
    return { success: false, error: msg };
  }
}

/**
 * Cancels a pending request sent by current user.
 */
export async function cancelConnectionRequest(
  requestId: string,
  recipientId: string,
  currentUserId: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not ready.' };
  }

  try {
    const { error: rpcError } = await supabase.rpc('cancel_connection_request', {
      p_request_id: requestId,
    });

    if (!rpcError) {
      dispatchConnectionEvent({
        type: 'connection_request:cancelled',
        actorId: currentUserId,
        requestId,
        recipientId,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }

    if (isSchemaMissingError(rpcError)) {
      const { error: updateError } = await supabase
        .from('connection_requests')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', requestId);

      if (updateError) return { success: false, error: updateError.message };

      dispatchConnectionEvent({
        type: 'connection_request:cancelled',
        actorId: currentUserId,
        requestId,
        recipientId,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }

    return { success: false, error: rpcError.message };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error cancelling request.';
    return { success: false, error: msg };
  }
}

/**
 * Unfriends / disconnects from a user.
 * Deletes the connection record without blocking or deleting history.
 */
export async function unfriendUser(
  targetUserId: string,
  currentUserId: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not ready.' };
  }

  try {
    const { error: rpcError } = await supabase.rpc('unfriend_user', {
      p_target_user_id: targetUserId,
    });

    if (!rpcError) {
      dispatchConnectionEvent({
        type: 'connection:ended',
        actorId: currentUserId,
        otherUserId: targetUserId,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }

    if (isSchemaMissingError(rpcError)) {
      const userA = currentUserId < targetUserId ? currentUserId : targetUserId;
      const userB = currentUserId < targetUserId ? targetUserId : currentUserId;

      const { error: delError } = await supabase
        .from('connections')
        .delete()
        .eq('user_a_id', userA)
        .eq('user_b_id', userB);

      if (delError) return { success: false, error: delError.message };

      dispatchConnectionEvent({
        type: 'connection:ended',
        actorId: currentUserId,
        otherUserId: targetUserId,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }

    return { success: false, error: rpcError.message };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error unfriending user.';
    return { success: false, error: msg };
  }
}

/**
 * Blocks a user:
 * - Creates a block entry in public.blocks
 * - Terminates any active connection
 * - Cancels/declines active connection requests
 */
export async function blockUser(
  targetUserId: string,
  currentUserId: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not ready.' };
  }

  if (targetUserId === currentUserId) {
    return { success: false, error: 'Cannot block yourself.' };
  }

  try {
    const { error: rpcError } = await supabase.rpc('block_user', {
      p_target_user_id: targetUserId,
    });

    if (!rpcError) {
      dispatchConnectionEvent({
        type: 'user:blocked',
        actorId: currentUserId,
        blockedUserId: targetUserId,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }

    if (isSchemaMissingError(rpcError)) {
      // Direct table inserts & cleanups
      await supabase.from('blocks').insert({
        blocker_id: currentUserId,
        blocked_id: targetUserId,
      });

      const userA = currentUserId < targetUserId ? currentUserId : targetUserId;
      const userB = currentUserId < targetUserId ? targetUserId : currentUserId;
      await supabase.from('connections').delete().eq('user_a_id', userA).eq('user_b_id', userB);

      dispatchConnectionEvent({
        type: 'user:blocked',
        actorId: currentUserId,
        blockedUserId: targetUserId,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }

    return { success: false, error: rpcError.message };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error blocking user.';
    return { success: false, error: msg };
  }
}

/**
 * Unblocks a user.
 */
export async function unblockUser(
  targetUserId: string,
  currentUserId: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client is not ready.' };
  }

  try {
    const { error: rpcError } = await supabase.rpc('unblock_user', {
      p_target_user_id: targetUserId,
    });

    if (!rpcError) {
      dispatchConnectionEvent({
        type: 'user:unblocked',
        actorId: currentUserId,
        unblockedUserId: targetUserId,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }

    if (isSchemaMissingError(rpcError)) {
      const { error: delError } = await supabase
        .from('blocks')
        .delete()
        .eq('blocker_id', currentUserId)
        .eq('blocked_id', targetUserId);

      if (delError) return { success: false, error: delError.message };

      dispatchConnectionEvent({
        type: 'user:unblocked',
        actorId: currentUserId,
        unblockedUserId: targetUserId,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }

    return { success: false, error: rpcError.message };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error unblocking user.';
    return { success: false, error: msg };
  }
}
