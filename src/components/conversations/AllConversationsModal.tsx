import React from 'react';
import { X, User, MessageSquare, Clock } from 'lucide-react';
import { TchatConversation } from '../../domains/conversations/types';

interface AllConversationsModalProps {
  conversations: TchatConversation[];
  isOpen: boolean;
  onClose: () => void;
  onSelectConversation: (conversation: TchatConversation) => void;
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
}) => {
  if (!isOpen) return null;

  return (
    <div
      id="all-conversations-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        id="all-conversations-modal"
        className="w-full max-w-sm max-h-[85vh] bg-stone-900 border border-stone-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-stone-800/80 shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-stone-400" />
            <h2 className="text-sm font-semibold text-stone-100">Conversation History</h2>
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

        {/* List of persistent conversations */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {conversations.length === 0 ? (
            <div className="py-8 text-center text-stone-400 text-xs">
              No conversations available. Connect with someone to begin.
            </div>
          ) : (
            conversations.map((conv) => {
              const partner = conv.other_participant;
              const dateDisplay = formatRelativeTime(conv.last_activity_at);

              return (
                <button
                  key={conv.id}
                  id={`all-conv-item-${conv.id}`}
                  type="button"
                  onClick={() => {
                    onSelectConversation(conv);
                    onClose();
                  }}
                  className="w-full p-3 rounded-xl bg-stone-950/60 hover:bg-stone-950 border border-stone-800/80 hover:border-stone-700/80 flex items-center gap-3 transition-colors text-left cursor-pointer group"
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
                        <span className="px-1.5 py-0.5 rounded-full bg-emerald-500 text-stone-950 text-[10px] font-bold">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
