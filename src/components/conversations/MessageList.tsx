import React, { useEffect, useRef } from 'react';
import { 
  Check, 
  CheckCheck, 
  Clock, 
  AlertCircle, 
  MessageSquare, 
  RotateCcw 
} from 'lucide-react';
import { TchatMessage, TchatParticipantProfile } from '../../domains/conversations/types';

interface MessageListProps {
  messages: TchatMessage[];
  currentUserId: string;
  partner: TchatParticipantProfile;
  onRetryMessage?: (tempId: string, content: string) => void;
}

function formatMessageTime(dateString: string): string {
  try {
    const d = new Date(dateString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  currentUserId,
  partner,
  onRetryMessage,
}) => {
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on message list changes
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.id, messages[messages.length - 1]?.status]);

  if (messages.length === 0) {
    return (
      <div 
        id="conversation-empty-state"
        className="flex-1 flex flex-col items-center justify-center p-6 text-center"
      >
        <div className="w-12 h-12 rounded-2xl bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-500 mb-3">
          <MessageSquare className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-semibold text-stone-200 mb-1">
          Conversation Ready
        </h3>
        <p className="text-xs text-stone-400 max-w-xs leading-relaxed">
          You are connected with <span className="text-stone-300 font-medium">@{partner.username}</span>.
          Send a message to begin. Active communication will appear in Home during your local day.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      id="conversation-message-list"
      className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
    >
      {messages.map((msg, index) => {
        const isMine = msg.sender_id === currentUserId;
        const formattedTime = formatMessageTime(msg.created_at);
        const isFailed = msg.status === 'failed';
        const isLastInSequence =
          index === messages.length - 1 ||
          messages[index + 1].sender_id !== msg.sender_id;

        return (
          <div
            key={msg.client_temp_id || msg.id}
            id={`message-item-${msg.client_temp_id || msg.id}`}
            className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[82%] sm:max-w-[72%] px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed break-words ${
                isMine
                  ? isFailed
                    ? 'bg-rose-950/40 text-stone-200 border border-rose-900/60 rounded-br-sm'
                    : 'bg-stone-800 text-stone-100 border border-stone-700/60 rounded-br-sm'
                  : 'bg-stone-900/90 text-stone-200 border border-stone-800/80 rounded-bl-sm'
              }`}
            >
              {msg.content}
            </div>

            {/* Message Metadata / Status */}
            <div
              className={`flex items-center gap-1.5 mt-1 px-1 text-[10px] text-stone-400 ${
                isMine ? 'justify-end' : 'justify-start'
              }`}
            >
              <span className="font-mono">{formattedTime}</span>

              {isMine && (
                <span className="inline-flex items-center">
                  {msg.status === 'sending' && (
                    <Clock 
                      className="w-3 h-3 text-stone-400 animate-pulse" 
                      aria-label="Sending" 
                    />
                  )}
                  {msg.status === 'sent' && (
                    <Check 
                      className="w-3 h-3 text-stone-400" 
                      aria-label="Sent" 
                    />
                  )}
                  {msg.status === 'delivered' && (
                    <CheckCheck 
                      className="w-3.5 h-3.5 text-stone-400" 
                      aria-label="Delivered" 
                    />
                  )}
                  {msg.status === 'read' && (
                    <CheckCheck 
                      className="w-3.5 h-3.5 text-emerald-400" 
                      aria-label="Read" 
                    />
                  )}
                  {isFailed && (
                    <div className="flex items-center gap-1 text-rose-400">
                      <AlertCircle className="w-3 h-3" />
                      <span>Failed</span>
                      {onRetryMessage && msg.content && (
                        <button
                          type="button"
                          onClick={() => onRetryMessage(msg.client_temp_id || msg.id, msg.content!)}
                          className="ml-1 underline flex items-center gap-0.5 hover:text-rose-300 cursor-pointer"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                </span>
              )}
            </div>
          </div>
        );
      })}

      <div ref={scrollEndRef} />
    </div>
  );
};
