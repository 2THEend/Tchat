/**
 * Connections Domain Events Architecture.
 * 
 * Provides typed domain event definitions and an in-process subscription dispatcher.
 * Future notification and Supabase Realtime infrastructure will consume these events.
 */

import { TchatConnection, TchatConnectionRequest } from './types';

export type ConnectionDomainEventType =
  | 'connection_request:created'
  | 'connection_request:accepted'
  | 'connection_request:declined'
  | 'connection_request:ignored'
  | 'connection_request:cancelled'
  | 'connection:ended'
  | 'user:blocked'
  | 'user:unblocked';

export interface BaseConnectionEvent {
  type: ConnectionDomainEventType;
  timestamp: string;
  actorId: string;
}

export interface ConnectionRequestCreatedEvent extends BaseConnectionEvent {
  type: 'connection_request:created';
  request: TchatConnectionRequest;
  recipientId: string;
}

export interface ConnectionRequestAcceptedEvent extends BaseConnectionEvent {
  type: 'connection_request:accepted';
  requestId: string;
  connection: TchatConnection;
  senderId: string;
}

export interface ConnectionRequestDeclinedEvent extends BaseConnectionEvent {
  type: 'connection_request:declined';
  requestId: string;
  senderId?: string;
}

export interface ConnectionRequestIgnoredEvent extends BaseConnectionEvent {
  type: 'connection_request:ignored';
  requestId: string;
}

export interface ConnectionRequestCancelledEvent extends BaseConnectionEvent {
  type: 'connection_request:cancelled';
  requestId: string;
  recipientId: string;
}

export interface ConnectionEndedEvent extends BaseConnectionEvent {
  type: 'connection:ended';
  otherUserId: string;
}

export interface UserBlockedEvent extends BaseConnectionEvent {
  type: 'user:blocked';
  blockedUserId: string;
}

export interface UserUnblockedEvent extends BaseConnectionEvent {
  type: 'user:unblocked';
  unblockedUserId: string;
}

export type ConnectionDomainEvent =
  | ConnectionRequestCreatedEvent
  | ConnectionRequestAcceptedEvent
  | ConnectionRequestDeclinedEvent
  | ConnectionRequestIgnoredEvent
  | ConnectionRequestCancelledEvent
  | ConnectionEndedEvent
  | UserBlockedEvent
  | UserUnblockedEvent;

export type ConnectionEventListener = (event: ConnectionDomainEvent) => void;

const listeners = new Set<ConnectionEventListener>();

/**
 * Dispatches a connection domain event to all registered listeners.
 */
export function dispatchConnectionEvent(event: ConnectionDomainEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('Error in connection domain event listener:', err);
    }
  }
}

/**
 * Subscribes to connection domain events. Returns an unsubscribe function.
 */
export function onConnectionEvent(listener: ConnectionEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
