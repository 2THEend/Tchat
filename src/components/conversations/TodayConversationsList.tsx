import React, { useState } from 'react';
import { MessageSquare, User, Clock, Archive } from 'lucide-react';
import { TchatConversation } from '../../domains/conversations/types';
import { isConversationActiveToday } from '../../domains/conversations/validation';
import { AllConversationsModal } from './AllConversationsModal';

interface TodayConversationsListProps {
  conversations: TchatConversation[];
  isLoading: boolean;
  onSelectConversation: (conversation: TchatConversation) => void;
  onOpenConnections: () => void;
}

function formatTodayTime(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const TodayConversationsList: React.FC<TodayConversationsListProps> = ({
  conversations,
  isLoading,
  onSelectConversation,
  onOpenConnections,
}) => {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Filter conversations that had meaningful activity during user's current local day
  const todayConversations = conversations.filter((conv) =>
    isConversationActiveToday(conv.last_activity_at)
  );

  return (
    <div id="today-conversations-section" className="space-y-3">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-stone-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-300">
            Today's Conversations
          </h2>
          {todayConversations.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-stone-800 text-stone-300 text-[10px] font-mono">
              {todayConversations.length}
            </span>
          )}
        </div>

        {conversations.length > 0 && (
          <button
            id="btn-open-conversation-history"
            type="button"
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
          >
            <Archive className="w-3 h-3" />
            <span>History ({conversations.length})</span>
          </button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="p-6 rounded-2xl bg-stone-900/40 border border-stone-800/60 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-stone-600 border-t-stone-200 rounded-full animate-spin" />
        </div>
      ) : todayConversations.length === 0 ? (
        <div
          id="today-conversations-empty"
          className="p-4 rounded-2xl bg-stone-900/40 border border-stone-800/60 space-y-2 text-center"
        >
          <p className="text-xs text-stone-300 font-medium">
            No conversations today yet
          </p>
          <p className="text-[11px] text-stone-400 max-w-xs mx-auto leading-relaxed">
            Conversations appear here when meaningful communication happens during your day.
          </p>
          <div className="flex items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={onOpenConnections}
              className="text-xs text-stone-200 hover:text-white underline underline-offset-2 font-medium cursor-pointer"
            >
              Message a connection
            </button>
            {conversations.length > 0 && (
              <>
                <span className="text-stone-600">•</span>
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(true)}
                  className="text-xs text-stone-400 hover:text-stone-300 underline underline-offset-2 cursor-pointer"
                >
                  View archive
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {todayConversations.map((conv) => {
            const partner = conv.other_participant;
            const timeDisplay = formatTodayTime(conv.last_activity_at);
            const unread = Number(conv.unread_count || 0);

            return (
              <button
                key={conv.id}
                id={`today-conv-card-${conv.id}`}
                type="button"
                onClick={() => onSelectConversation(conv)}
                className="w-full p-3.5 rounded-2xl bg-stone-900/70 hover:bg-stone-900 border border-stone-800/80 hover:border-stone-700/80 flex items-center gap-3.5 transition-all text-left cursor-pointer group"
              >
                {/* Partner Avatar */}
                <div className="w-11 h-11 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
                  {partner?.avatar_url ? (
                    <img
                      src={partner.avatar_url}
                      alt={partner.display_name || partner.username}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-5 h-5 text-stone-400" />
                  )}
                </div>

                {/* Conversation Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-xs font-semibold text-stone-100 truncate group-hover:text-white">
                      {partner?.display_name || partner?.username || 'Tchat Member'}
                    </span>
                    <span className="text-[10px] text-stone-400 font-mono shrink-0 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {timeDisplay}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-stone-400 truncate">
                      {conv.last_message_preview || 'No messages yet'}
                    </p>
                    {unread > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-emerald-500 text-stone-950 text-[10px] font-bold shrink-0">
                        {unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* History Archive Modal */}
      <AllConversationsModal
        conversations={conversations}
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onSelectConversation={onSelectConversation}
      />
    </div>
  );
};
