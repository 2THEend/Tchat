/**
 * Groups Realtime Subscription Helper — Stage 5
 * Handles Supabase Realtime channel subscription for group messages
 * with reconnect resync logic.
 */

import { supabase } from '../../lib/supabase';
import { CircleMessage, GroupMessage } from './types';
import { getGroupMessages } from './groupsService';
import { getCircleMessages } from './circlesService';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface GroupRealtimeOptions {
  groupId: string;
  onMessage: (message: GroupMessage) => void;
  onResyncRequired?: () => void;
  onError?: (err: any) => void;
}

/**
 * Subscribes to realtime messages for a group.
 * Backed by Supabase Realtime postgres_changes on public.group_messages.
 */
export function subscribeToGroupMessages(options: GroupRealtimeOptions): () => void {
  const { groupId, onMessage, onResyncRequired, onError } = options;

  if (!supabase) {
    onError?.(new Error('Supabase client not initialized'));
    return () => {};
  }

  const channelName = `group-messages:${groupId}`;
  const channel: RealtimeChannel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'group_messages',
        filter: `group_id=eq.${groupId}`,
      },
      (payload) => {
        const row = payload.new as any;
        if (!row) return;

        const message: GroupMessage = {
          id: row.id,
          group_id: row.group_id,
          sender_id: row.sender_id,
          message_type: row.message_type,
          content: row.content,
          media_asset_id: row.media_asset_id,
          sequence_number: Number(row.sequence_number),
          created_at: row.created_at,
        };

        onMessage(message);
      }
    )
    .subscribe((status, err) => {
      if (err) {
        onError?.(err);
      }
      if (status === 'SUBSCRIBED') {
        // Channel connected
      } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
        // Trigger resync
        onResyncRequired?.();
      }
    });

  return () => {
    supabase?.removeChannel(channel);
  };
}

/**
 * Performs catch-up resync after reconnecting or missing messages.
 */
export async function resyncGroupMessages(
  groupId: string,
  lastKnownSequenceNumber: number
): Promise<GroupMessage[]> {
  const result = await getGroupMessages(groupId, 100, undefined, lastKnownSequenceNumber);
  return result.data || [];
}

export interface CircleRealtimeOptions {
  circleId: string;
  onMessage: (message: CircleMessage) => void;
  onResyncRequired?: () => void;
  onError?: (err: any) => void;
}

/**
 * Subscribes to realtime messages for a Circle.
 * Backed by Supabase Realtime postgres_changes on public.circle_messages.
 */
export function subscribeToCircleMessages(options: CircleRealtimeOptions): () => void {
  const { circleId, onMessage, onResyncRequired, onError } = options;

  if (!supabase) {
    onError?.(new Error('Supabase client not initialized'));
    return () => {};
  }

  const channelName = `circle-messages:${circleId}`;
  const channel: RealtimeChannel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'circle_messages',
        filter: `circle_id=eq.${circleId}`,
      },
      (payload) => {
        const row = payload.new as any;
        if (!row) return;

        const message: CircleMessage = {
          id: row.id,
          circle_id: row.circle_id,
          sender_id: row.sender_id,
          message_type: row.message_type,
          content: row.content,
          media_asset_id: row.media_asset_id,
          sequence_number: Number(row.sequence_number),
          created_at: row.created_at,
        };

        onMessage(message);
      }
    )
    .subscribe((status, err) => {
      if (err) {
        onError?.(err);
      }
      if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
        onResyncRequired?.();
      }
    });

  return () => {
    supabase?.removeChannel(channel);
  };
}

/**
 * Performs catch-up resync after reconnecting or missing circle messages.
 */
export async function resyncCircleMessages(
  circleId: string,
  lastKnownSequenceNumber: number
): Promise<CircleMessage[]> {
  const result = await getCircleMessages(circleId, 100, undefined, lastKnownSequenceNumber);
  return result.data || [];
}

