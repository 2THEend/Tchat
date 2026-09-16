import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Database, AlertCircle } from 'lucide-react';
import { 
  TchatMessage, 
  TchatParticipantProfile 
} from '../../domains/conversations/types';
import { TchatMediaAsset } from '../../domains/media/types';
import { TchatStreak } from '../../domains/streaks/types';
import { 
  getConversationMessages, 
  sendMessage as apiSendMessage, 
  markConversationRead 
} from '../../domains/conversations/conversationsService';
import { getConversationStreaks } from '../../domains/streaks/streaksService';
import { subscribeToConversation } from '../../domains/conversations/realtime';
import { onMediaEvent } from '../../domains/media/events';
import { onStreakEvent } from '../../domains/streaks/events';
import { ConversationHeader } from './ConversationHeader';
import { MessageList } from './MessageList';
import { MessageComposer } from './MessageComposer';
import { FirstUseMediaSaveTip } from './FirstUseMediaSaveTip';
import { StreakBadges } from './streaks/StreakBadges';
import { PendingStreakBanner } from './streaks/PendingStreakBanner';
import { StreaksModal } from './streaks/StreaksModal';

interface ConversationViewProps {
  conversationId: string;
  currentUserId: string;
  partner: TchatParticipantProfile;
  onBack: () => void;
}

export const ConversationView: React.FC<ConversationViewProps> = ({
  conversationId,
  currentUserId,
  partner,
  onBack,
}) => {
  const [messages, setMessages] = useState<TchatMessage[]>([]);
  const [streaks, setStreaks] = useState<TchatStreak[]>([]);
  const [isStreaksModalOpen, setIsStreaksModalOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isSchemaPending, setIsSchemaPending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fetch streaks for this conversation
  const loadStreaks = useCallback(async () => {
    try {
      const res = await getConversationStreaks(conversationId);
      if (!isMountedRef.current) return;
      if (res.data) {
        setStreaks(res.data);
      }
    } catch (err) {
      console.error('[ConversationView] Error loading streaks:', err);
    }
  }, [conversationId]);

  // Fetch messages from PostgreSQL database
  const loadMessages = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await getConversationMessages(conversationId, 100);

      if (!isMountedRef.current) return;

      if (res.isSchemaPending) {
        setIsSchemaPending(true);
        return;
      }

      if (res.error) {
        setErrorMessage(res.error);
      } else {
        setMessages(res.data || []);
        // Automatically mark as read if any incoming unread messages exist
        markConversationRead(conversationId, currentUserId).catch(() => {});
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setErrorMessage(err?.message || 'Error loading conversation messages.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [conversationId, currentUserId]);

  useEffect(() => {
    loadMessages();
    loadStreaks();
  }, [loadMessages, loadStreaks]);

  // Subscribe to Realtime messages and status updates
  useEffect(() => {
    const unsubscribe = subscribeToConversation(conversationId, {
      onNewMessage: (incomingMsg) => {
        setMessages((prev) => {
          // If we already have this message (or by client_temp_id), don't duplicate
          const exists = prev.some((m) => m.id === incomingMsg.id);
          if (exists) return prev;

          // If it was sent by current user, replace any matching optimistic message
          if (incomingMsg.sender_id === currentUserId) {
            const tempIdx = prev.findIndex(
              (m) => m.status === 'sending' && m.content === incomingMsg.content
            );
            if (tempIdx !== -1) {
              const updated = [...prev];
              updated[tempIdx] = incomingMsg;
              return updated;
            }
          }

          return [...prev, incomingMsg];
        });

        // If message is from partner, mark it as read and refresh streaks
        if (incomingMsg.sender_id !== currentUserId) {
          markConversationRead(conversationId, currentUserId).catch(() => {});
          loadStreaks();
        }
      },
      onMessageUpdated: (updatedMsg) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m))
        );
      },
      onReconnected: () => {
        // Authoritative resynchronization after connection drops
        loadMessages(true);
        loadStreaks();
      },
    });

    // Realtime Media Event synchronization (e.g. recipient saves media)
    const unsubscribeMedia = onMediaEvent((event) => {
      if (event.conversationId === conversationId && event.type === 'media:saved' && event.asset) {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.media_asset_id === event.mediaAssetId || msg.media?.id === event.mediaAssetId) {
              return {
                ...msg,
                media: {
                  ...(msg.media || event.asset!),
                  is_saved: true,
                  is_expired: false,
                  saved_at: event.timestamp,
                  saved_by_id: event.savedByUserId || msg.media?.saved_by_id,
                },
              };
            }
            return msg;
          })
        );
      }
    });

    // Streak event listener for immediate updates
    const unsubscribeStreak = onStreakEvent((event) => {
      if (event.streak?.conversation_id === conversationId) {
        loadStreaks();
      }
    });

    return () => {
      unsubscribe();
      unsubscribeMedia();
      unsubscribeStreak();
    };
  }, [conversationId, currentUserId, loadMessages, loadStreaks]);

  // Handle message sending with optimistic UI updates
  const handleSendMessage = async (
    content: string, 
    mediaAssetId?: string, 
    mediaAsset?: TchatMediaAsset
  ) => {
    setIsSending(true);
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const messageType = mediaAssetId ? 'media' : 'text';

    const optimisticMessage: TchatMessage = {
      id: tempId,
      client_temp_id: tempId,
      conversation_id: conversationId,
      sender_id: currentUserId,
      message_type: messageType,
      content: content || null,
      media_asset_id: mediaAssetId || null,
      media: mediaAsset || null,
      sequence_number: Date.now(),
      status: 'sending',
      delivered_at: null,
      read_at: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const res = await apiSendMessage(conversationId, content, messageType, mediaAssetId);

      if (res.isSchemaPending) {
        setIsSchemaPending(true);
        setMessages((prev) =>
          prev.map((m) =>
            m.client_temp_id === tempId
              ? { ...m, status: 'failed', error: 'Database schema pending.' }
              : m
          )
        );
        return;
      }

      if (res.error) {
        setMessages((prev) =>
          prev.map((m) =>
            m.client_temp_id === tempId
              ? { ...m, status: 'failed', error: res.error }
              : m
          )
        );
      } else if (res.data) {
        const confirmedMsg = res.data;
        setMessages((prev) =>
          prev.map((m) =>
            m.client_temp_id === tempId 
              ? { ...confirmedMsg, client_temp_id: tempId, media: confirmedMsg.media || mediaAsset } 
              : m
          )
        );
        // Refresh streaks to pick up any qualifying interaction
        loadStreaks();
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.client_temp_id === tempId
            ? { ...m, status: 'failed', error: err?.message || 'Send failed' }
            : m
        )
      );
    } finally {
      if (isMountedRef.current) {
        setIsSending(false);
      }
    }
  };

  const handleMediaSaved = (updatedAsset: TchatMediaAsset) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.media_asset_id === updatedAsset.id || msg.media?.id === updatedAsset.id) {
          return { ...msg, media: updatedAsset };
        }
        return msg;
      })
    );
  };

  // Retry sending a failed message
  const handleRetryMessage = async (tempId: string, content: string) => {
    // Remove the failed message and re-send
    setMessages((prev) => prev.filter((m) => (m.client_temp_id || m.id) !== tempId));
    await handleSendMessage(content);
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadMessages(false);
    loadStreaks();
  };

  return (
    <div 
      id="conversation-view-container"
      className="flex-1 flex flex-col h-full bg-stone-950 overflow-hidden relative"
    >
      {/* Top Header */}
      <ConversationHeader
        partner={partner}
        onBack={onBack}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        onOpenStreaks={() => setIsStreaksModalOpen(true)}
        activeStreakCount={streaks.filter((s) => s.state === 'active').length}
        hasPendingStreak={streaks.some((s) => s.state === 'pending')}
      />

      {/* Streak Continuity Badges */}
      <StreakBadges
        streaks={streaks}
        onOpenModal={() => setIsStreaksModalOpen(true)}
        hasPending={streaks.some((s) => s.state === 'pending')}
      />

      {/* Pending Streak Requests (Accept / Decline / Cancel) */}
      {streaks
        .filter((s) => s.state === 'pending')
        .map((pendingStreak) => (
          <PendingStreakBanner
            key={pendingStreak.id}
            streak={pendingStreak}
            currentUserId={currentUserId}
            partnerName={partner.display_name || partner.username}
            onStreakUpdated={loadStreaks}
          />
        ))}

      {/* Schema Pending Banner */}
      {isSchemaPending && (
        <div className="p-3 bg-amber-950/50 border-b border-amber-900/60 text-amber-200 text-xs flex items-center gap-2">
          <Database className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold">Media Schema Pending:</span> Please apply migration{' '}
            <code className="bg-amber-900/40 px-1 py-0.5 rounded font-mono text-[11px]">
              20260914030000_create_tchat_media_assets.sql
            </code>{' '}
            in Supabase SQL Editor.
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="p-2.5 bg-rose-950/50 border-b border-rose-900/60 text-rose-200 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="flex-1">{errorMessage}</span>
        </div>
      )}

      {/* Ephemeral Media Save Tip */}
      <FirstUseMediaSaveTip />

      {/* Message Area */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-stone-600 border-t-stone-200 rounded-full animate-spin" />
        </div>
      ) : (
        <MessageList
          messages={messages}
          currentUserId={currentUserId}
          partner={partner}
          conversationId={conversationId}
          onRetryMessage={handleRetryMessage}
          onMediaSaved={handleMediaSaved}
        />
      )}

      {/* Message Composer */}
      <MessageComposer
        conversationId={conversationId}
        onSend={handleSendMessage}
        isSending={isSending}
        disabled={isSchemaPending}
      />

      {/* Streaks Modal / Drawer */}
      <StreaksModal
        isOpen={isStreaksModalOpen}
        onClose={() => setIsStreaksModalOpen(false)}
        streaks={streaks}
        conversationId={conversationId}
        partnerName={partner.display_name || partner.username}
        currentUserId={currentUserId}
        onStreakUpdated={loadStreaks}
      />
    </div>
  );
};
