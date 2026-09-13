import { useState } from 'react';
import { Check, X, EyeOff, User, MessageSquare, AlertCircle } from 'lucide-react';
import { TchatConnectionRequest } from '../../domains/connections/types';

interface IncomingRequestsListProps {
  requests: TchatConnectionRequest[];
  onAccept: (requestId: string, senderId?: string) => Promise<void>;
  onDecline: (requestId: string, senderId?: string) => Promise<void>;
  onIgnore: (requestId: string) => Promise<void>;
  isLoading: boolean;
}

export function IncomingRequestsList({
  requests,
  onAccept,
  onDecline,
  onIgnore,
  isLoading,
}: IncomingRequestsListProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAction = async (
    requestId: string,
    action: () => Promise<void>
  ) => {
    setProcessingId(requestId);
    setActionError(null);
    try {
      await action();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed.';
      setActionError(msg);
    } finally {
      setProcessingId(null);
    }
  };

  if (requests.length === 0 && !isLoading) {
    return (
      <div id="incoming-requests-empty" className="p-8 text-center rounded-2xl bg-stone-900/30 border border-stone-800/40 space-y-1">
        <p className="text-xs font-medium text-stone-300">No incoming requests</p>
        <p className="text-[11px] text-stone-400">
          When someone requests to connect with you and provides their context, it will appear here.
        </p>
      </div>
    );
  }

  return (
    <div id="incoming-requests-list" className="space-y-3">
      {actionError && (
        <div className="flex items-center gap-1.5 p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {requests.map((req) => {
        const sender = req.sender;
        const isBusy = processingId === req.id;
        const dateFormatted = new Date(req.created_at).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });

        return (
          <div
            key={req.id}
            id={`incoming-request-${req.id}`}
            className="p-4 rounded-2xl bg-stone-900/70 border border-stone-800/80 space-y-3"
          >
            {/* Sender Identity Info */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
                  {sender?.avatar_url ? (
                    <img 
                      src={sender.avatar_url} 
                      alt={sender.display_name || sender.username} 
                      className="w-full h-full object-cover" 
                    />
                  ) : (
                    <User className="w-5 h-5 text-stone-400" />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="text-xs font-semibold text-stone-100 truncate">
                    {sender?.display_name || sender?.username || 'Tchat Member'}
                  </div>
                  <div className="text-[11px] font-mono text-stone-400">
                    @{sender?.username || 'member'}
                  </div>
                </div>
              </div>

              <span className="text-[10px] text-stone-400 font-mono shrink-0">
                {dateFormatted}
              </span>
            </div>

            {/* Mandatory Context / Reason from Sender */}
            <div className="p-3 rounded-xl bg-stone-950/70 border border-stone-800/50 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-semibold tracking-wider text-stone-400">
                <MessageSquare className="w-3 h-3 text-stone-400" />
                <span>Context / Reason</span>
              </div>
              <p className="text-xs text-stone-200 leading-relaxed break-words">
                "{req.context}"
              </p>
            </div>

            {/* Three Actions: Accept, Decline, Ignore */}
            <div className="flex items-center gap-2 pt-1">
              <button
                id={`btn-accept-${req.id}`}
                type="button"
                disabled={isBusy}
                onClick={() => handleAction(req.id, () => onAccept(req.id, req.sender_id))}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Accept</span>
              </button>

              <button
                id={`btn-decline-${req.id}`}
                type="button"
                disabled={isBusy}
                onClick={() => handleAction(req.id, () => onDecline(req.id, req.sender_id))}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-stone-900 border border-stone-800 hover:border-rose-900/60 hover:text-rose-400 hover:bg-rose-950/20 text-stone-300 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Decline</span>
              </button>

              <button
                id={`btn-ignore-${req.id}`}
                type="button"
                disabled={isBusy}
                onClick={() => handleAction(req.id, () => onIgnore(req.id))}
                title="Ignore request (removes from active queue without notifying)"
                className="py-2 px-2.5 rounded-xl bg-stone-900 border border-stone-800 hover:bg-stone-800 text-stone-400 hover:text-stone-300 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
              >
                <EyeOff className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
