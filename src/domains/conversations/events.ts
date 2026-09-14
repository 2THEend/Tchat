/**
 * Conversation Domain Event Bus
 */

import { TchatMessage } from './types';

export type ConversationDomainEvent =
  | { type: 'message:sent'; conversationId: string; message: TchatMessage }
  | { type: 'message:received'; conversationId: string; message: TchatMessage }
  | { type: 'conversation:read'; conversationId: string; userId: string }
  | { type: 'conversation:activity_updated'; conversationId: string; lastActivityAt: string };

type Listener = (event: ConversationDomainEvent) => void;
const listeners = new Set<Listener>();

export function emitConversationEvent(event: ConversationDomainEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch (err) {
      console.error('Conversation event listener error:', err);
    }
  });
}

export function onConversationEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
