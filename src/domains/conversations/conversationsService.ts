/**
 * Conversations & Messaging Service Layer
 * Interfaces directly with Supabase client and PostgreSQL RPCs.
 */

import { supabase } from '../../lib/supabase';
import { 
  TchatConversation, 
  TchatMessage, 
  ConversationsServiceResult 
} from './types';
import { validateTextMessageContent } from './validation';
import { emitConversationEvent } from './events';

function isPendingSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = err.message || '';
  const code = err.code || '';
  return (
    code === '42P01' || // undefined_table
    code === 'PGRST202' || // function not found
    code === 'PGRST204' || // table not found
    msg.includes('schema cache') ||
    msg.includes('conversations') ||
    msg.includes('messages') ||
    msg.includes('function get_user_conversations') ||
    msg.includes('function send_message') ||
    msg.includes('function get_or_create_conversation')
  );
}

/**
 * Retrieves all persistent 1:1 conversations for the current user.
 */
export async function getUserConversations(
  currentUserId: string
): Promise<ConversationsServiceResult<TchatConversation[]>> {
  if (!supabase) {
    return { data: [], error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_user_conversations');

    if (error) {
      if (isPendingSchemaError(error)) {
        return { data: [], isSchemaPending: true, error: error.message };
      }
      return { data: [], error: error.message };
    }

    const conversations: TchatConversation[] = (data || []).map((row: any) => ({
      id: row.id,
      connection_id: row.connection_id,
      user_a_id: row.user_a_id,
      user_b_id: row.user_b_id,
      last_activity_at: row.last_activity_at,
      last_activity_type: row.last_activity_type,
      last_message_preview: row.last_message_preview,
      last_sender_id: row.last_sender_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      unread_count: Number(row.unread_count || 0),
      other_participant: {
        id: row.other_id,
        username: row.other_username,
        display_name: row.other_display_name,
        avatar_url: row.other_avatar_url,
      },
    }));

    return { data: conversations };
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { data: [], isSchemaPending: true, error: err?.message };
    }
    return { data: [], error: err?.message || 'Failed to fetch conversations.' };
  }
}

/**
 * Gets or creates the persistent 1:1 conversation between current user and a connected user.
 * Guarantees exactly one 1:1 conversation exists without creating Home activity.
 */
export async function getOrCreateConversation(
  otherUserId: string
): Promise<ConversationsServiceResult<TchatConversation>> {
  if (!supabase) {
    return { error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_or_create_conversation', {
      p_other_user_id: otherUserId,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { isSchemaPending: true, error: error.message };
      }
      return { error: error.message };
    }

    if (!data) {
      return { error: 'No conversation returned from server.' };
    }

    const conv: TchatConversation = {
      id: data.id,
      connection_id: data.connection_id,
      user_a_id: data.user_a_id,
      user_b_id: data.user_b_id,
      last_activity_at: data.last_activity_at,
      last_activity_type: data.last_activity_type,
      last_message_preview: data.last_message_preview,
      last_sender_id: data.last_sender_id,
      created_at: data.created_at,
      updated_at: data.updated_at,
      other_participant: data.other_participant,
    };

    return { data: conv };
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { isSchemaPending: true, error: err?.message };
    }
    return { error: err?.message || 'Failed to open conversation.' };
  }
}

/**
 * Retrieves authoritative chronological messages for a conversation.
 */
export async function getConversationMessages(
  conversationId: string,
  limit: number = 50,
  beforeSeq?: number
): Promise<ConversationsServiceResult<TchatMessage[]>> {
  if (!supabase) {
    return { data: [], error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_conversation_messages', {
      p_conversation_id: conversationId,
      p_limit: limit,
      p_before_seq: beforeSeq || null,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { data: [], isSchemaPending: true, error: error.message };
      }
      return { data: [], error: error.message };
    }

    const messages: TchatMessage[] = (data || []).map((row: any) => ({
      id: row.id,
      conversation_id: row.conversation_id,
      sender_id: row.sender_id,
      message_type: row.message_type,
      content: row.content,
      media_asset_id: row.media_asset_id,
      sequence_number: Number(row.sequence_number),
      status: row.status,
      delivered_at: row.delivered_at,
      read_at: row.read_at,
      created_at: row.created_at,
    }));

    return { data: messages };
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { data: [], isSchemaPending: true, error: err?.message };
    }
    return { data: [], error: err?.message || 'Failed to fetch messages.' };
  }
}

/**
 * Sends a message in a conversation.
 * Performs client-side validation then invokes the authoritative send_message RPC.
 * Automatically updates conversation last_activity_at and triggers the event bus.
 */
export async function sendMessage(
  conversationId: string,
  content: string,
  messageType: 'text' | 'media' = 'text',
  mediaAssetId?: string
): Promise<ConversationsServiceResult<TchatMessage>> {
  if (!supabase) {
    return { error: 'Supabase client is not initialized.' };
  }

  if (messageType === 'text') {
    const validation = validateTextMessageContent(content);
    if (!validation.isValid) {
      return { error: validation.error };
    }
    content = validation.cleanContent;
  }

  try {
    const { data, error } = await supabase.rpc('send_message', {
      p_conversation_id: conversationId,
      p_content: content,
      p_message_type: messageType,
      p_media_asset_id: mediaAssetId || null,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { isSchemaPending: true, error: error.message };
      }
      return { error: error.message };
    }

    const message: TchatMessage = {
      id: data.id,
      conversation_id: data.conversation_id,
      sender_id: data.sender_id,
      message_type: data.message_type,
      content: data.content,
      media_asset_id: data.media_asset_id,
      sequence_number: Number(data.sequence_number),
      status: data.status,
      delivered_at: data.delivered_at,
      read_at: data.read_at,
      created_at: data.created_at,
    };

    emitConversationEvent({
      type: 'message:sent',
      conversationId,
      message,
    });

    emitConversationEvent({
      type: 'conversation:activity_updated',
      conversationId,
      lastActivityAt: message.created_at,
    });

    return { data: message };
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { isSchemaPending: true, error: err?.message };
    }
    return { error: err?.message || 'Failed to send message.' };
  }
}

/**
 * Marks unread messages in a conversation as read by the recipient.
 */
export async function markConversationRead(
  conversationId: string,
  currentUserId: string
): Promise<ConversationsServiceResult<number>> {
  if (!supabase) {
    return { data: 0, error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('mark_conversation_read', {
      p_conversation_id: conversationId,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { data: 0, isSchemaPending: true, error: error.message };
      }
      return { data: 0, error: error.message };
    }

    const count = Number(data || 0);

    if (count > 0) {
      emitConversationEvent({
        type: 'conversation:read',
        conversationId,
        userId: currentUserId,
      });
    }

    return { data: count };
  } catch (err: any) {
    return { data: 0, error: err?.message || 'Failed to mark conversation read.' };
  }
}
