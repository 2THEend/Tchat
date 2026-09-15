/**
 * Streaks Domain Event Bus
 * Dispatches lifecycle changes (initiated, accepted, declined, progressed, dormant, ended)
 * for reactive UI synchronization without polling.
 */

import { StreakEvent } from './types';

type StreakEventListener = (event: StreakEvent) => void;

const listeners = new Set<StreakEventListener>();

/**
 * Emits a streak lifecycle event to all subscribed listeners.
 */
export function emitStreakEvent(event: StreakEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('[StreakEventBus] Error in event listener:', err);
    }
  }
}

/**
 * Subscribes a listener to streak events.
 * Returns an unsubscribe callback.
 */
export function onStreakEvent(listener: StreakEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
