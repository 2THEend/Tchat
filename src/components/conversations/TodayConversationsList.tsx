import React, { useState } from 'react';
import { MessageSquare, User, Clock, History, Archive } from 'lucide-react';
import { TchatConversation } from '../../domains/conversations/types';
import { shouldConversationAppearOnHome } from '../../domains/conversations/validation';
import { archiveConversation } from '../../domains/conversations/conversationsService';
import { AllConversationsModal } from './AllConversationsModal';

interface TodayConversationsListProps {
  conversations: TchatConversation[];
  isLoading: boolean;
  onSelectConversation: (conversation: TchatConversation) => void;
  onOpenConnections: () => void;
  currentUserId?: string;
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
  currentUserId,
}) => {
  const [modalMode, setModalMode] = useState<'history' | 'archive' | null>(null);
  const [isArchivingId, setIsArchivingId] = useState<string | null>(null);

  // Home semantics: 1:1 conversations with qualifying activity during user's current local day
  // (Excludes archived conversations unless new activity occurred today after being archived)
  const todayConversations = conversations.filter((conv) =>
    shouldConversationAppearOnHome(conv)
  );

  // Normal persistent conversation history (all non-archived conversations)
  const historyConversations = conversations.filter((conv) => !conv.is_archived);

  // Explicitly archived conversations
  const archivedConversations = conversations.filter((conv) => Boolean(conv.is_archived));

  const handleQuickArchive = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    setIsArchivingId(conversationId);
    try {
      await archiveConversation(conversationId, currentUserId);
    } finally {
      setIsArchivingId(null);
    }
  };

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
          <div className="flex items-center gap-2.5">
            <button
              id="btn-open-conversation-history"
              type="button"
              onClick={() => setModalMode('history')}
              className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
            >
              <History className="w-3.5 h-3.5" />
              <span>History ({historyConversations.length})</span>
            </button>

            <span className="text-stone-700 text-xs">•</span>

            <button
              id="btn-open-conversation-archive"
              type="button"
              onClick={() => setModalMode('archive')}
              className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-amber-300 transition-colors cursor-pointer"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Archive ({archivedConversations.length})</span>
            </button>
          </div>
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
            {historyConversations.length > 0 && (
              <>
                <span className="text-stone-600">•</span>
                <button
                  id="btn-empty-state-view-history"
                  type="button"
                  onClick={() => setModalMode('history')}
                  className="text-xs text-stone-400 hover:text-stone-200 underline underline-offset-2 cursor-pointer"
                >
                  Browse history ({historyConversations.length})
                </button>
              </>
            )}
            {archivedConversations.length > 0 && (
              <>
                <span className="text-stone-600">•</span>
                <button
                  id="btn-empty-state-view-archive"
                  type="button"
                  onClick={() => setModalMode('archive')}
                  className="text-xs text-stone-400 hover:text-amber-300 underline underline-offset-2 cursor-pointer"
                >
                  View archive ({archivedConversations.length})
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
            const isArchiving = isArchivingId === conv.id;

            return (
              <div
                key={conv.id}
                id={`today-conv-card-${conv.id}`}
                className="w-full p-3 rounded-2xl bg-stone-900/70 hover:bg-stone-900 border border-stone-800/80 hover:border-stone-700/80 flex items-center gap-3.5 transition-all text-left group"
              >
                <button
                  type="button"
                  onClick={() => onSelectConversation(conv)}
                  className="flex-1 min-w-0 flex items-center gap-3.5 text-left cursor-pointer"
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

                {/* Quick Archive Action */}
                <button
                  id={`btn-today-archive-${conv.id}`}
                  type="button"
                  disabled={isArchiving}
                  onClick={(e) => handleQuickArchive(e, conv.id)}
                  title="Archive conversation"
                  aria-label={`Archive conversation with ${partner?.display_name || partner?.username || 'member'}`}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-500 hover:text-amber-400 hover:bg-stone-800 transition-colors shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40 cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* History or Archive Surface Modal */}
      <AllConversationsModal
        conversations={conversations}
        isOpen={modalMode !== null}
        mode={modalMode || 'history'}
        onClose={() => setModalMode(null)}
        onSelectConversation={onSelectConversation}
        currentUserId={currentUserId}
      />
    </div>
  );
};
