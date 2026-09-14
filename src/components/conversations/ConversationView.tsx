import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Database, AlertCircle } from 'lucide-react';
import { 
  TchatMessage, 
  TchatParticipantProfile 
} from '../../domains/conversations/types';
import { 
  getConversationMessages, 
  sendMessage as apiSendMessage, 
  markConversationRead 
} from '../../domains/conversations/conversationsService';
import { subscribeToConversation } from '../../domains/conversations/realtime';
import { ConversationHeader } from './ConversationHeader';
import { MessageList } from './MessageList';
import { MessageComposer } from './MessageComposer';

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
  }, [loadMessages]);

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

        // If message is from partner, mark it as read
        if (incomingMsg.sender_id !== currentUserId) {
          markConversationRead(conversationId, currentUserId).catch(() => {});
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
      },
    });

    return () => {
      unsubscribe();
    };
  }, [conversationId, currentUserId, loadMessages]);

  // Handle message sending with optimistic UI updates
  const handleSendMessage = async (content: string) => {
    setIsSending(true);
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const optimisticMessage: TchatMessage = {
      id: tempId,
      client_temp_id: tempId,
      conversation_id: conversationId,
      sender_id: currentUserId,
      message_type: 'text',
      content,
      media_asset_id: null,
      sequence_number: Date.now(),
      status: 'sending',
      delivered_at: null,
      read_at: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const res = await apiSendMessage(conversationId, content, 'text');

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
            m.client_temp_id === tempId ? { ...confirmedMsg, client_temp_id: tempId } : m
          )
        );
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

  // Retry sending a failed message
  const handleRetryMessage = async (tempId: string, content: string) => {
    // Remove the failed message and re-send
    setMessages((prev) => prev.filter((m) => (m.client_temp_id || m.id) !== tempId));
    await handleSendMessage(content);
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadMessages(false);
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
      />

      {/* Schema Pending Banner */}
      {isSchemaPending && (
        <div className="p-3 bg-amber-950/50 border-b border-amber-900/60 text-amber-200 text-xs flex items-center gap-2">
          <Database className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold">Conversations Schema Pending:</span> Please apply migration{' '}
            <code className="bg-amber-900/40 px-1 py-0.5 rounded font-mono text-[11px]">
              20260913020000_create_tchat_conversations_and_messages.sql
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
          onRetryMessage={handleRetryMessage}
        />
      )}

      {/* Message Composer */}
      <MessageComposer
        onSend={handleSendMessage}
        isSending={isSending}
        disabled={isSchemaPending}
      />
    </div>
  );
};
