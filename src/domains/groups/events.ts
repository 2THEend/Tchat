/**
 * Groups Domain Event Bus — Stage 4
 * Provides lightweight synchronization for group membership changes,
 * role transitions, and access requests.
 */

export type GroupEventType =
  | 'group:created'
  | 'group:joined'
  | 'group:left'
  | 'group:role_changed'
  | 'group:member_removed'
  | 'group:member_banned'
  | 'group:member_unbanned'
  | 'group:request_created'
  | 'group:request_approved'
  | 'group:request_declined'
  | 'group:request_cancelled'
  | 'group:message_received'
  | 'group:messages_read'
  | 'group:media_saved';

export interface GroupEvent {
  type: GroupEventType;
  groupId: string;
  payload?: Record<string, any>;
  timestamp: number;
}

type GroupEventListener = (event: GroupEvent) => void;

const listeners: Set<GroupEventListener> = new Set();

/**
 * Subscribes a listener to group domain events.
 * Returns an unsubscribe callback.
 */
export function onGroupEvent(listener: GroupEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Dispatches a group domain event to all subscribers.
 */
export function emitGroupEvent(
  type: GroupEventType,
  groupId: string,
  payload?: Record<string, any>
): void {
  const event: GroupEvent = {
    type,
    groupId,
    payload,
    timestamp: Date.now(),
  };

  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (err) {
      console.error('[Group Event Bus] Error in listener callback:', err);
    }
  });
}
