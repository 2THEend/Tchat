/**
 * Calls Domain Realtime Integration
 * Subscribes to database events on the public.calls table for live state updates.
 * NOTE: This is strictly for Call lifecycle state changes, NOT WebRTC signaling.
 */

import { supabase } from '../../lib/supabase';
import { TchatCall } from './types';
import { emitCallEvent } from './events';
import { getCallEventDedupeKey } from './validation';

export interface CallSubscriptionHandlers {
  onCallUpdated?: (call: TchatCall) => void;
}

export interface UserIncomingCallSubscriptionHandlers {
  onIncomingCallChange?: (call: TchatCall, eventType: string) => void;
  onReconnected?: () => void;
}

const activeRecipientSubscriptions = new Map<string, () => void>();

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

/**
 * Subscribes globally at the application shell level to incoming call changes
 * for the authenticated recipient user (`recipient_id = userId`).
 * - Prevents duplicate subscriptions for the same user.
 * - Ignores duplicate realtime broadcasts for identical call state transitions.
 * - Cleans up cleanly on logout, user switch, or unmount.
 */
export function subscribeToUserIncomingCalls(
  userId: string,
  handlers: UserIncomingCallSubscriptionHandlers
): () => void {
  if (!userId) {
    return () => {};
  }

  // Clean up any existing subscription for this user to prevent duplicate listeners
  const existingCleanup = activeRecipientSubscriptions.get(userId);
  if (existingCleanup) {
    existingCleanup();
  }

  const seenEventKeys = new Set<string>();
  let isCleanedUp = false;

  if (!supabase) {
    const noopCleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      seenEventKeys.clear();
      if (activeRecipientSubscriptions.get(userId) === noopCleanup) {
        activeRecipientSubscriptions.delete(userId);
      }
    };
    activeRecipientSubscriptions.set(userId, noopCleanup);
    return noopCleanup;
  }

  const channelName = `calls:recipient:${userId}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'calls',
        filter: `recipient_id=eq.${userId}`,
      },
      (payload) => {
        if (isCleanedUp) return;

        const call = (payload.new || payload.old) as TchatCall;
        if (!call || call.recipient_id !== userId) return;

        const dedupeKey = `${payload.eventType}:${getCallEventDedupeKey(call)}`;
        if (seenEventKeys.has(dedupeKey)) {
          return;
        }
        seenEventKeys.add(dedupeKey);

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

        handlers.onIncomingCallChange?.(call, payload.eventType);
      }
    )
    .subscribe((status) => {
      if (!isCleanedUp && status === 'SUBSCRIBED') {
        handlers.onReconnected?.();
      }
    });

  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    seenEventKeys.clear();
    if (activeRecipientSubscriptions.get(userId) === cleanup) {
      activeRecipientSubscriptions.delete(userId);
    }
    supabase?.removeChannel(channel);
  };

  activeRecipientSubscriptions.set(userId, cleanup);
  return cleanup;
}

/**
 * Returns the number of currently active global recipient call subscriptions (used for verification/testing).
 */
export function getActiveRecipientSubscriptionCount(): number {
  return activeRecipientSubscriptions.size;
}

