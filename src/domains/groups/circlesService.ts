/**
 * Circles Domain Service Layer — Phase 6.5
 * Authoritative Server RPCs and Storage operations for Group Circles.
 */

import { supabase } from '../../lib/supabase';
import {
  CircleMember,
  CircleMessage,
  CreateCircleInput,
  GroupMessageMedia,
  GroupMessageType,
  GroupServiceResult,
  TchatCircle,
} from './types';
import { validateCreateCircleInput } from './validation';
import { validateMediaFile } from '../media/validation';
import { emitGroupEvent } from './events';

/**
 * Creates an intentional temporary Circle inside an active Group.
 * Maximum 24-hour lifetime, authoritative database timestamp.
 * Creator becomes initial active member automatically.
 */
export async function createCircle(
  groupId: string,
  input: CreateCircleInput
): Promise<GroupServiceResult<TchatCircle>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  const validation = validateCreateCircleInput(input);
  if (!validation.isValid) {
    return { data: null, error: validation.error || 'Invalid circle input.' };
  }

  try {
    const { data, error } = await supabase.rpc('create_circle', {
      p_group_id: groupId,
      p_name: input.name.trim(),
      p_reason: input.reason?.trim() || null,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    emitGroupEvent('group:circle_created', groupId, { circle: data });
    return { data: data as TchatCircle, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to create circle' };
  }
}

/**
 * Retrieves all active, unexpired Circles within a Group.
 */
export async function getGroupCircles(
  groupId: string
): Promise<GroupServiceResult<TchatCircle[]>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_group_circles', {
      p_group_id: groupId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: (data || []) as TchatCircle[], error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to fetch group circles' };
  }
}

/**
 * Retrieves details for a specific Circle.
 */
export async function getCircleDetails(
  circleId: string
): Promise<GroupServiceResult<TchatCircle>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_circle_details', {
      p_circle_id: circleId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    if (!data) {
      return { data: null, error: 'Circle not found or has been deleted.' };
    }

    return { data: data as TchatCircle, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to fetch circle details' };
  }
}

/**
 * Joins a Circle. Caller must be an active member of parent Group.
 * Joining a Circle does NOT modify Group membership.
 */
export async function joinCircle(
  circleId: string
): Promise<GroupServiceResult<{ member_count: number; is_member: boolean }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('join_circle', {
      p_circle_id: circleId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to join circle' };
  }
}

/**
 * Leaves a Circle. Leaving Circle does NOT leave the parent Group.
 */
export async function leaveCircle(
  circleId: string
): Promise<GroupServiceResult<{ member_count: number; is_member: boolean }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('leave_circle', {
      p_circle_id: circleId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to leave circle' };
  }
}

/**
 * Ends a Circle early. Caller must be circle creator or parent group admin/mod.
 */
export async function endCircle(
  circleId: string
): Promise<GroupServiceResult<{ ended_at: string; lifecycle_status: string }>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('end_circle', {
      p_circle_id: circleId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to end circle' };
  }
}

/**
 * Lists active members of a Circle.
 */
export async function listCircleMembers(
  circleId: string
): Promise<GroupServiceResult<CircleMember[]>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('list_circle_members', {
      p_circle_id: circleId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: (data || []) as CircleMember[], error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to list circle members' };
  }
}

/**
 * Retrieves chronological messages for a Circle.
 * Caller must be an active member of the Circle.
 */
export async function getCircleMessages(
  circleId: string,
  limit: number = 50,
  beforeSeq?: number,
  afterSeq?: number
): Promise<GroupServiceResult<CircleMessage[]>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_circle_messages', {
      p_circle_id: circleId,
      p_limit: limit,
      p_before_seq: beforeSeq || null,
      p_after_seq: afterSeq || null,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: (data || []) as CircleMessage[], error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to fetch circle messages' };
  }
}

/**
 * Sends a message in a Circle.
 * Caller must be an active member of the Circle, and parent group must be active.
 */
export async function sendCircleMessage(
  circleId: string,
  content: string,
  messageType: GroupMessageType = 'text',
  mediaAssetId?: string
): Promise<GroupServiceResult<CircleMessage>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('send_circle_message', {
      p_circle_id: circleId,
      p_content: content,
      p_message_type: messageType,
      p_media_asset_id: mediaAssetId || null,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as CircleMessage, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to send circle message' };
  }
}

/**
 * Marks circle messages as read up to the specified message ID.
 */
export async function markCircleMessagesRead(
  circleId: string,
  messageId: string
): Promise<GroupServiceResult<void>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  try {
    const { error } = await supabase.rpc('mark_circle_messages_read', {
      p_circle_id: circleId,
      p_message_id: messageId,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: undefined, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to mark circle read' };
  }
}

/**
 * Uploads an ephemeral media file for a Circle.
 * Uploads to conversation-media bucket under groups/${groupId}/
 * and registers it via create_circle_media_asset.
 */
export async function uploadCircleMediaFile(
  circleId: string,
  groupId: string,
  file: File,
  options?: { allowRecipientSave?: boolean }
): Promise<GroupServiceResult<GroupMessageMedia>> {
  if (!supabase) {
    return { data: null, error: 'Supabase client is not initialized.' };
  }

  const validation = validateMediaFile(file);
  if (!validation.isValid || !validation.mediaType || !validation.cleanFilename) {
    return { data: null, error: validation.error || 'Invalid media file.' };
  }

  try {
    const uniqueId = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const storagePath = `groups/${groupId}/${uniqueId}-${validation.cleanFilename}`;

    const { error: uploadError } = await supabase.storage
      .from('conversation-media')
      .upload(storagePath, file, {
        cacheControl: 'no-cache, no-store, must-revalidate',
        upsert: false,
      });

    if (uploadError) {
      return { data: null, error: uploadError.message || 'Failed to upload media to storage.' };
    }

    const { data, error } = await supabase.rpc('create_circle_media_asset', {
      p_circle_id: circleId,
      p_storage_path: storagePath,
      p_media_type: validation.mediaType,
      p_mime_type: file.type,
      p_file_size_bytes: file.size,
      p_original_filename: validation.cleanFilename,
      p_allow_recipient_save: options?.allowRecipientSave !== false,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as GroupMessageMedia, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Circle media upload failed.' };
  }
}
