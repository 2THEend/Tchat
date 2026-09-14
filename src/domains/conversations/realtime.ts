/**
 * Supabase Realtime Subscription Manager for Conversations
 * 
 * Handles:
 * - Realtime incoming message events (INSERT)
 * - Realtime delivery and read status updates (UPDATE)
 * - Channel reconnects and authoritative database recovery
 */

import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { TchatMessage } from './types';

export interface ConversationRealtimeHandlers {
  onNewMessage: (message: TchatMessage) => void;
  onMessageUpdated: (message: TchatMessage) => void;
  onReconnected?: () => void;
  onError?: (err: any) => void;
}

/**
 * Subscribes to realtime updates for a single conversation.
 * Returns an unsubscribe function.
 */
export function subscribeToConversation(
  conversationId: string,
  handlers: ConversationRealtimeHandlers
): () => void {
  if (!supabase) {
    return () => {};
  }

  let channel: RealtimeChannel | null = null;
  let hasInitiallyConnected = false;

  try {
    const channelName = `conversation:${conversationId}:${Date.now()}`;
    channel = supabase.channel(channelName);

    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (!payload.new) return;
          const raw = payload.new as any;
          const msg: TchatMessage = {
            id: raw.id,
            conversation_id: raw.conversation_id,
            sender_id: raw.sender_id,
            message_type: raw.message_type,
            content: raw.content,
            media_asset_id: raw.media_asset_id,
            sequence_number: Number(raw.sequence_number),
            status: raw.status,
            delivered_at: raw.delivered_at,
            read_at: raw.read_at,
            created_at: raw.created_at,
          };
          handlers.onNewMessage(msg);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (!payload.new) return;
          const raw = payload.new as any;
          const msg: TchatMessage = {
            id: raw.id,
            conversation_id: raw.conversation_id,
            sender_id: raw.sender_id,
            message_type: raw.message_type,
            content: raw.content,
            media_asset_id: raw.media_asset_id,
            sequence_number: Number(raw.sequence_number),
            status: raw.status,
            delivered_at: raw.delivered_at,
            read_at: raw.read_at,
            created_at: raw.created_at,
          };
          handlers.onMessageUpdated(msg);
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          if (hasInitiallyConnected && handlers.onReconnected) {
            // Reconnected after a network disconnect or timeout - resync from database
            handlers.onReconnected();
          }
          hasInitiallyConnected = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (handlers.onError && err) {
            handlers.onError(err);
          }
        }
      });
  } catch (err) {
    if (handlers.onError) {
      handlers.onError(err);
    }
  }

  return () => {
    if (channel && supabase) {
      supabase.removeChannel(channel);
    }
  };
}
