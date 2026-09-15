/**
 * Ephemeral Media Domain Event Bus
 * Dispatches domain events across components to synchronize media lifecycle state.
 */

import { TchatMediaAsset } from './types';

export type MediaDomainEventType = 
  | 'media:created'
  | 'media:saved'
  | 'media:expired';

export interface MediaDomainEvent {
  type: MediaDomainEventType;
  mediaAssetId: string;
  conversationId: string;
  asset?: TchatMediaAsset;
  savedByUserId?: string;
  timestamp: string;
}

type MediaEventListener = (event: MediaDomainEvent) => void;

const listeners: Set<MediaEventListener> = new Set();

export function onMediaEvent(listener: MediaEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitMediaEvent(event: MediaDomainEvent): void {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (err) {
      console.error('[MediaEventBus] Listener error:', err);
    }
  });
}
