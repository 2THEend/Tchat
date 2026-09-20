/**
 * Groups Domain Service Layer — Stage 4: Membership & Access Operations
 * Calls server-authoritative SECURITY DEFINER PostgreSQL RPCs.
 */

import { supabase } from '../../lib/supabase';
import {
  CreateGroupInput,
  GroupDetails,
  GroupMessage,
  GroupMessageType,
  GroupRole,
  GroupServiceResult,
  TchatGroup,
  TchatGroupJoinRequest,
  TchatGroupMember,
  UserActiveGroupItem,
} from './types';
import {
  validateAssignRole,
  validateCreateGroupInput,
  validateJoinQuestionAnswer,
} from './validation';
import { emitGroupEvent } from './events';

/**
 * Creates an intentional temporary social group.
 * Atomically inserts the group and makes the creator the initial active Admin.
 */
export async function createGroup(
  input: CreateGroupInput
): Promise<GroupServiceResult<{ group_id: string; [key: string]: any }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  const validation = validateCreateGroupInput(input);
  if (!validation.isValid) {
    return { data: null, error: validation.error || 'Invalid group configuration' };
  }

  try {
    const { data, error } = await supabase.rpc('create_group', {
      p_name: input.name.trim(),
      p_reason: input.reason.trim(),
      p_lifetime: input.lifetime,
      p_visibility: input.visibility,
      p_access_mode: input.access_mode,
      p_joining_question: input.joiningQuestion ? input.joiningQuestion.trim() : null,
      p_max_size: input.maxSize ?? 30,
      p_cover_url: input.coverUrl ?? null,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:created', data.group_id, { name: input.name });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to create group' };
  }
}

/**
 * Direct join for open groups (subject to surge check and 30-member capacity boundary).
 */
export async function joinGroup(
  groupId: string
): Promise<GroupServiceResult<{ group_id: string; role: string; [key: string]: any }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('join_group', {
      p_group_id: groupId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:joined', groupId, { role: data.role });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to join group' };
  }
}

/**
 * Submits a request to join a group (for request or question mode, or when 50% capacity reached).
 */
export async function requestToJoinGroup(
  groupId: string,
  questionAnswer?: string
): Promise<GroupServiceResult<{ request_id: string; [key: string]: any }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  if (questionAnswer !== undefined && questionAnswer !== null) {
    const validation = validateJoinQuestionAnswer(questionAnswer);
    if (!validation.isValid) {
      return { data: null, error: validation.error || 'Invalid question answer' };
    }
  }

  try {
    const { data, error } = await supabase.rpc('request_to_join_group', {
      p_group_id: groupId,
      p_question_answer: questionAnswer?.trim() ?? null,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:request_created', groupId, { requestId: data.request_id });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to submit join request' };
  }
}

/**
 * Cancels a pending join request by the requesting user.
 */
export async function cancelGroupJoinRequest(
  requestId: string,
  groupId: string
): Promise<GroupServiceResult<{ success: boolean }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('cancel_group_join_request', {
      p_request_id: requestId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:request_cancelled', groupId, { requestId });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to cancel join request' };
  }
}

/**
 * Approves a pending join request. Caller must be Admin or Mod.
 */
export async function approveGroupJoinRequest(
  requestId: string,
  groupId: string
): Promise<GroupServiceResult<{ success: boolean; user_id: string }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('approve_group_join_request', {
      p_request_id: requestId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:request_approved', groupId, { requestId, userId: data.user_id });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to approve join request' };
  }
}

/**
 * Declines a pending join request. Caller must be Admin or Mod.
 */
export async function declineGroupJoinRequest(
  requestId: string,
  groupId: string
): Promise<GroupServiceResult<{ success: boolean }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('decline_group_join_request', {
      p_request_id: requestId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:request_declined', groupId, { requestId });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to decline join request' };
  }
}

/**
 * Assigns a member role (mod, special, or member). Caller must be Admin.
 */
export async function assignMemberRole(
  groupId: string,
  targetUserId: string,
  newRole: GroupRole
): Promise<GroupServiceResult<{ success: boolean; new_role: GroupRole }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  const validation = validateAssignRole(newRole);
  if (!validation.isValid) {
    return { data: null, error: validation.error || 'Invalid role assignment' };
  }

  try {
    const { data, error } = await supabase.rpc('assign_group_member_role', {
      p_group_id: groupId,
      p_target_user_id: targetUserId,
      p_new_role: newRole,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:role_changed', groupId, { targetUserId, newRole });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to assign role' };
  }
}

/**
 * Atomically transfers Admin role to an active member. Caller must be current Admin.
 */
export async function transferGroupAdmin(
  groupId: string,
  successorUserId: string
): Promise<GroupServiceResult<{ success: boolean; new_admin_id: string }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('transfer_group_admin', {
      p_group_id: groupId,
      p_successor_user_id: successorUserId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:role_changed', groupId, { targetUserId: successorUserId, newRole: 'admin' });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to transfer admin role' };
  }
}

/**
 * Removes a member from the group. Caller must be Admin or Mod.
 */
export async function removeMember(
  groupId: string,
  targetUserId: string,
  reason?: string
): Promise<GroupServiceResult<{ success: boolean }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('remove_group_member', {
      p_group_id: groupId,
      p_target_user_id: targetUserId,
      p_reason: reason?.trim() ?? null,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:member_removed', groupId, { targetUserId });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to remove member' };
  }
}

/**
 * Bans a user from the group. Caller must be Admin or Mod.
 */
export async function banMember(
  groupId: string,
  targetUserId: string,
  reason?: string
): Promise<GroupServiceResult<{ success: boolean }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('ban_group_member', {
      p_group_id: groupId,
      p_target_user_id: targetUserId,
      p_reason: reason?.trim() ?? null,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:member_banned', groupId, { targetUserId });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to ban member' };
  }
}

/**
 * Unbans a user from the group. Caller must be Admin or Mod.
 */
export async function unbanMember(
  groupId: string,
  targetUserId: string
): Promise<GroupServiceResult<{ success: boolean }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('unban_group_member', {
      p_group_id: groupId,
      p_target_user_id: targetUserId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:member_unbanned', groupId, { targetUserId });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to unban member' };
  }
}

/**
 * Leaves a group. If caller is Admin, must provide successor if other active members exist.
 */
export async function leaveGroup(
  groupId: string,
  successorUserId?: string
): Promise<GroupServiceResult<{ success: boolean; remaining_members: number }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('leave_group', {
      p_group_id: groupId,
      p_successor_user_id: successorUserId ?? null,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:left', groupId, { remainingMembers: data.remaining_members });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to leave group' };
  }
}

/**
 * Fetches group details, effective access mode, and caller's membership status.
 */
export async function getGroupDetails(
  groupId: string
): Promise<GroupServiceResult<GroupDetails>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_group_details', {
      p_group_id: groupId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to fetch group details' };
  }
}

/**
 * Lists active members of a group. Caller must be an active member.
 */
export async function listGroupMembers(
  groupId: string
): Promise<GroupServiceResult<TchatGroupMember[]>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('list_group_members', {
      p_group_id: groupId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to list group members' };
  }
}

/**
 * Lists pending join requests. Caller must be Admin or Mod.
 */
export async function getGroupJoinRequests(
  groupId: string
): Promise<GroupServiceResult<TchatGroupJoinRequest[]>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_group_join_requests', {
      p_group_id: groupId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to fetch join requests' };
  }
}

/**
 * Checks if the caller has an active pending join request for the given group.
 */
export async function getMyPendingJoinRequest(
  groupId: string
): Promise<GroupServiceResult<TchatGroupJoinRequest | null>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUserId = sessionData?.session?.user?.id;
    if (!currentUserId) {
      return { data: null, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('group_join_requests')
      .select('id, group_id, user_id, question_answer, status, created_at')
      .eq('group_id', groupId)
      .eq('user_id', currentUserId)
      .eq('status', 'pending')
      .maybeSingle();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data || null, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to check join request' };
  }
}

/**
 * Checks if the caller is banned from the given group.
 */
export async function checkGroupBanStatus(
  groupId: string
): Promise<GroupServiceResult<{ isBanned: boolean; reason?: string | null }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUserId = sessionData?.session?.user?.id;
    if (!currentUserId) {
      return { data: null, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('group_bans')
      .select('reason')
      .eq('group_id', groupId)
      .eq('user_id', currentUserId)
      .maybeSingle();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: { isBanned: !!data, reason: data?.reason || null }, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to check ban status' };
  }
}

/**
 * Fetches all groups where the specified user is an active member.
 */
export async function getUserActiveGroups(
  userId: string
): Promise<GroupServiceResult<UserActiveGroupItem[]>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase
      .from('group_members')
      .select(`
        group_id,
        role,
        joined_at,
        group:groups (
          id,
          name,
          reason,
          cover_url,
          lifetime,
          expires_at,
          grace_expires_at,
          visibility,
          access_mode,
          joining_question,
          max_size,
          lifecycle_status,
          created_by_id,
          created_at,
          updated_at
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      return { data: null, error: error.message };
    }

    const items: UserActiveGroupItem[] = (data || [])
      .filter((row: any) => row.group && row.group.lifecycle_status === 'active')
      .map((row: any) => ({
        group_id: row.group_id,
        role: row.role as GroupRole,
        joined_at: row.joined_at,
        group: row.group as TchatGroup,
      }));

    return { data: items, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to fetch active groups' };
  }
}

/**
 * Fetches active discoverable groups for discovery/joining.
 */
export async function getDiscoverableGroups(
  limit: number = 20
): Promise<GroupServiceResult<TchatGroup[]>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('groups')
      .select('*')
      .eq('visibility', 'discoverable')
      .eq('lifecycle_status', 'active')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: (data as TchatGroup[]) || [], error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to fetch discoverable groups' };
  }
}


/**
 * Sends a message in a group.
 * Caller must be an active group member and group must be active/unexpired.
 */
export async function sendGroupMessage(
  groupId: string,
  content: string,
  messageType: GroupMessageType = 'text',
  mediaAssetId?: string
): Promise<GroupServiceResult<GroupMessage>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  if (messageType === 'text') {
    const clean = content ? content.trim() : '';
    if (!clean || clean.length < 1) {
      return { data: null, error: 'Message content cannot be empty' };
    }
    if (clean.length > 2000) {
      return { data: null, error: 'Message content exceeds maximum length of 2000 characters' };
    }
    content = clean;
  }

  try {
    const { data, error } = await supabase.rpc('send_group_message', {
      p_group_id: groupId,
      p_content: content,
      p_message_type: messageType,
      p_media_asset_id: mediaAssetId || null,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:message_received', groupId, { message: data });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to send group message' };
  }
}

/**
 * Fetches chronological messages for a group with pagination.
 */
export async function getGroupMessages(
  groupId: string,
  limit: number = 50,
  beforeSeq?: number,
  afterSeq?: number
): Promise<GroupServiceResult<GroupMessage[]>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_group_messages', {
      p_group_id: groupId,
      p_limit: limit,
      p_before_seq: beforeSeq || null,
      p_after_seq: afterSeq || null,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    const messages: GroupMessage[] = (data || []).map((row: any) => ({
      id: row.id,
      group_id: row.group_id,
      sender_id: row.sender_id,
      message_type: row.message_type,
      content: row.content,
      media_asset_id: row.media_asset_id,
      sequence_number: Number(row.sequence_number),
      created_at: row.created_at,
      sender: row.sender_username ? {
        id: row.sender_id,
        username: row.sender_username,
        display_name: row.sender_display_name,
        avatar_url: row.sender_avatar_url,
        role: row.sender_role,
      } : undefined,
      media: row.media || null,
    }));

    return { data: messages, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to fetch group messages' };
  }
}

/**
 * Updates the caller's read marker for a group.
 * Prevents moving backwards.
 */
export async function markGroupMessagesRead(
  groupId: string,
  messageId: string
): Promise<GroupServiceResult<{ last_read_message_id: string; unchanged?: boolean }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('mark_group_messages_read', {
      p_group_id: groupId,
      p_message_id: messageId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:messages_read', groupId, { messageId });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to mark group messages read' };
  }
}

/**
 * Registers an ephemeral media asset for a group.
 */
export async function createGroupMediaAsset(
  groupId: string,
  storagePath: string,
  mediaType: 'image' | 'video' | 'audio' | 'file',
  mimeType?: string,
  fileSizeBytes?: number,
  originalFilename?: string,
  allowRecipientSave: boolean = true
): Promise<GroupServiceResult<any>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('create_group_media_asset', {
      p_group_id: groupId,
      p_storage_path: storagePath,
      p_media_type: mediaType,
      p_mime_type: mimeType || null,
      p_file_size_bytes: fileSizeBytes || null,
      p_original_filename: originalFilename || null,
      p_allow_recipient_save: allowRecipientSave,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to create group media asset' };
  }
}
