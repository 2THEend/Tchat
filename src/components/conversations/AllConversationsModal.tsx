import React, { useState } from 'react';
import { X, User, History, Archive, ArchiveRestore, Clock } from 'lucide-react';
import { TchatConversation } from '../../domains/conversations/types';
import { archiveConversation, unarchiveConversation } from '../../domains/conversations/conversationsService';

interface AllConversationsModalProps {
  conversations: TchatConversation[];
  isOpen: boolean;
  onClose: () => void;
  onSelectConversation: (conversation: TchatConversation) => void;
  currentUserId?: string;
  mode?: 'history' | 'archive';
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'No activity yet';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export const AllConversationsModal: React.FC<AllConversationsModalProps> = ({
  conversations,
  isOpen,
  onClose,
  onSelectConversation,
  currentUserId,
  mode = 'history',
}) => {
  const [isProcessingId, setIsProcessingId] = useState<string | null>(null);

  if (!isOpen) return null;

  // History shows all non-archived normal 1:1 conversations
  const historyList = conversations.filter((c) => !c.is_archived);

  // Archive shows only explicitly archived conversations
  const archivedList = conversations.filter((c) => Boolean(c.is_archived));

  const handleArchive = async (conversationId: string) => {
    setIsProcessingId(conversationId);
    try {
      await archiveConversation(conversationId, currentUserId);
    } finally {
      setIsProcessingId(null);
    }
  };

  const handleUnarchive = async (conversationId: string) => {
    setIsProcessingId(conversationId);
    try {
      await unarchiveConversation(conversationId, currentUserId);
    } finally {
      setIsProcessingId(null);
    }
  };

  const isArchiveMode = mode === 'archive';

  return (
    <div
      id="all-conversations-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        id={isArchiveMode ? 'archived-conversations-modal' : 'conversation-history-modal'}
        className="w-full max-w-sm max-h-[85vh] bg-stone-900 border border-stone-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-stone-800/80 shrink-0">
          <div className="flex items-center gap-2">
            {isArchiveMode ? (
              <>
                <Archive className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-stone-100">Archived Conversations</h2>
                <span className="px-1.5 py-0.5 rounded-full bg-stone-800 text-stone-300 text-[10px] font-mono">
                  {archivedList.length}
                </span>
              </>
            ) : (
              <>
                <History className="w-4 h-4 text-stone-300" />
                <h2 className="text-sm font-semibold text-stone-100">Conversation History</h2>
                <span className="px-1.5 py-0.5 rounded-full bg-stone-800 text-stone-300 text-[10px] font-mono">
                  {historyList.length}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isArchiveMode ? (
            <>
              {/* Archive Information */}
              <div className="p-2.5 rounded-xl bg-amber-950/20 border border-amber-900/30 text-[11px] text-amber-200/80 mb-2">
                Archived conversations are kept separate from History. Any new message activity will surface on Home today.
              </div>

              {/* Explicitly Archived Conversations List */}
              {archivedList.length === 0 ? (
                <div className="py-8 text-center text-stone-400 text-xs space-y-1">
                  <p className="font-medium text-stone-300">No archived conversations</p>
                  <p className="text-[11px] text-stone-500">Conversations you archive will appear here.</p>
                </div>
              ) : (
                archivedList.map((conv) => {
                  const partner = conv.other_participant;
                  const dateDisplay = formatRelativeTime(conv.last_activity_at);
                  const isProcessing = isProcessingId === conv.id;

                  return (
                    <div
                      key={conv.id}
                      id={`archived-conv-item-${conv.id}`}
                      className="w-full p-2.5 rounded-xl bg-stone-950/60 hover:bg-stone-950 border border-stone-800/80 hover:border-stone-700/80 flex items-center gap-3 transition-colors text-left group"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectConversation(conv);
                          onClose();
                        }}
                        className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer"
                      >
                        <div className="w-10 h-10 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
                          {partner?.avatar_url ? (
                            <img
                              src={partner.avatar_url}
                              alt={partner.display_name || partner.username}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User className="w-4 h-4 text-stone-400" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className="text-xs font-semibold text-stone-200 truncate group-hover:text-stone-100">
                              {partner?.display_name || partner?.username || 'Tchat Member'}
                            </span>
                            <span className="text-[10px] text-stone-400 font-mono shrink-0 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              {dateDisplay}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] text-stone-400 truncate">
                              {conv.last_message_preview || 'No messages yet'}
                            </p>
                            <span className="text-[10px] text-amber-400/80 font-mono shrink-0">
                              Archived
                            </span>
                          </div>
                        </div>
                      </button>

                      {/* Explicit Unarchive Action */}
                      <button
                        id={`btn-unarchive-conv-${conv.id}`}
                        type="button"
                        disabled={isProcessing}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnarchive(conv.id);
                        }}
                        title="Unarchive conversation"
                        aria-label={`Unarchive conversation with ${partner?.display_name || partner?.username || 'member'}`}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-500 hover:text-emerald-400 hover:bg-stone-800 transition-colors shrink-0 disabled:opacity-40 cursor-pointer"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </>
          ) : (
            <>
              {/* Normal 1:1 History List (Clean, without nested Archive button) */}
              {historyList.length === 0 ? (
                <div className="py-8 text-center text-stone-400 text-xs space-y-1">
                  <p className="font-medium text-stone-300">No conversation history yet</p>
                  <p className="text-[11px] text-stone-500">Conversations with your connections persist here.</p>
                </div>
              ) : (
                historyList.map((conv) => {
                  const partner = conv.other_participant;
                  const dateDisplay = formatRelativeTime(conv.last_activity_at);
                  const isProcessing = isProcessingId === conv.id;

                  return (
                    <div
                      key={conv.id}
                      id={`all-conv-item-${conv.id}`}
                      className="w-full p-2.5 rounded-xl bg-stone-950/60 hover:bg-stone-950 border border-stone-800/80 hover:border-stone-700/80 flex items-center gap-3 transition-colors text-left group"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectConversation(conv);
                          onClose();
                        }}
                        className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer"
                      >
                        <div className="w-10 h-10 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
                          {partner?.avatar_url ? (
                            <img
                              src={partner.avatar_url}
                              alt={partner.display_name || partner.username}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User className="w-4 h-4 text-stone-400" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className="text-xs font-semibold text-stone-200 truncate group-hover:text-stone-100">
                              {partner?.display_name || partner?.username || 'Tchat Member'}
                            </span>
                            <span className="text-[10px] text-stone-400 font-mono shrink-0 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              {dateDisplay}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] text-stone-400 truncate">
                              {conv.last_message_preview || 'No messages yet'}
                            </p>
                            {Number(conv.unread_count || 0) > 0 && (
                              <span className="px-1.5 py-0.5 rounded-full bg-emerald-500 text-stone-950 text-[10px] font-bold shrink-0">
                                {conv.unread_count}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>

                      {/* Explicit Archive Action */}
                      <button
                        id={`btn-archive-conv-${conv.id}`}
                        type="button"
                        disabled={isProcessing}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArchive(conv.id);
                        }}
                        title="Archive conversation"
                        aria-label={`Archive conversation with ${partner?.display_name || partner?.username || 'member'}`}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-500 hover:text-amber-400 hover:bg-stone-800 transition-colors shrink-0 disabled:opacity-40 cursor-pointer"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
