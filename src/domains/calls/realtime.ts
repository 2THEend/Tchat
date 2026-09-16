/**
 * Calls Domain Realtime Integration
 * Subscribes to database events on the public.calls table for live state updates.
 * NOTE: This is strictly for Call lifecycle state changes, NOT WebRTC signaling.
 */

import { supabase } from '../../lib/supabase';
import { TchatCall } from './types';
import { emitCallEvent } from './events';

export interface CallSubscriptionHandlers {
  onCallUpdated?: (call: TchatCall) => void;
}

/**
 * Subscribes to real-time call changes for a specific conversation.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeToConversationCalls(
  conversationId: string,
  handlers: CallSubscriptionHandlers
): () => void {
  if (!supabase) {
    return () => {};
  }

  const channelName = `calls:conv:${conversationId}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'calls',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const call = (payload.new || payload.old) as TchatCall;
        if (!call) return;

        if (payload.eventType === 'INSERT') {
          emitCallEvent('call:requested', call);
        } else if (payload.eventType === 'UPDATE') {
          if (call.status === 'accepted') {
            emitCallEvent('call:accepted', call);
          } else if (call.status === 'declined') {
            emitCallEvent('call:declined', call);
          } else if (call.status === 'cancelled') {
            emitCallEvent('call:cancelled', call);
          } else if (call.status === 'expired') {
            emitCallEvent('call:expired', call);
          }
        }

        handlers.onCallUpdated?.(call);
      }
    )
    .subscribe();

  return () => {
    supabase?.removeChannel(channel);
  };
}
