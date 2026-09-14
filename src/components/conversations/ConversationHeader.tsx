import { ArrowLeft, User, RotateCw } from 'lucide-react';
import { TchatParticipantProfile } from '../../domains/conversations/types';

interface ConversationHeaderProps {
  partner: TchatParticipantProfile;
  onBack: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export function ConversationHeader({
  partner,
  onBack,
  onRefresh,
  isRefreshing = false,
}: ConversationHeaderProps) {
  return (
    <header 
      id="conversation-header"
      className="shrink-0 flex items-center justify-between px-4 py-3 bg-stone-950/95 backdrop-blur-md border-b border-stone-800/80 z-20"
    >
      <div className="flex items-center gap-3 min-w-0">
        <button
          id="btn-conversation-back"
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="w-10 h-10 -ml-1.5 rounded-xl flex items-center justify-center text-stone-400 hover:text-stone-100 hover:bg-stone-900 transition-colors shrink-0 cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
            {partner.avatar_url ? (
              <img
                src={partner.avatar_url}
                alt={partner.display_name || partner.username}
                className="w-full h-full object-cover"
              />
            ) : (
              <User className="w-4 h-4 text-stone-400" />
            )}
          </div>

          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-stone-100 truncate leading-tight">
              {partner.display_name || partner.username}
            </h1>
            <p className="text-[11px] font-mono text-stone-400 truncate leading-tight">
              @{partner.username}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          id="btn-refresh-conversation"
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh messages"
          className="w-9 h-9 rounded-xl flex items-center justify-center text-stone-400 hover:text-stone-200 hover:bg-stone-900 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
        </button>
      </div>
    </header>
  );
}
