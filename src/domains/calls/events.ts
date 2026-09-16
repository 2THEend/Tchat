/**
 * Calls Domain Event Bus
 * Synchronizes call state across conversation and contextual headers without full re-renders.
 */

import { TchatCall } from './types';

export type CallEventType = 
  | 'call:requested'
  | 'call:accepted'
  | 'call:declined'
  | 'call:cancelled'
  | 'call:expired';

export interface CallEvent {
  type: CallEventType;
  call: TchatCall;
  timestamp: number;
}

type CallEventListener = (event: CallEvent) => void;

const listeners: Set<CallEventListener> = new Set();

/**
 * Subscribes a listener to calls events.
 * Returns an unsubscribe callback.
 */
export function onCallEvent(listener: CallEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Dispatches a calls domain event.
 */
export function emitCallEvent(type: CallEventType, call: TchatCall): void {
  const event: CallEvent = {
    type,
    call,
    timestamp: Date.now(),
  };

  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (err) {
      console.error('[Calls Event Bus] Error in listener callback:', err);
    }
  });
}
