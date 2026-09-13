import { useState } from 'react';
import { Clock, User, X, AlertCircle } from 'lucide-react';
import { TchatConnectionRequest } from '../../domains/connections/types';

interface SentRequestsListProps {
  requests: TchatConnectionRequest[];
  onCancel: (requestId: string, recipientId: string) => Promise<void>;
  isLoading: boolean;
}

export function SentRequestsList({
  requests,
  onCancel,
  isLoading,
}: SentRequestsListProps) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCancel = async (requestId: string, recipientId: string) => {
    setCancellingId(requestId);
    setError(null);
    try {
      await onCancel(requestId, recipientId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel request.';
      setError(msg);
    } finally {
      setCancellingId(null);
    }
  };

  if (requests.length === 0 && !isLoading) {
    return (
      <div id="sent-requests-empty" className="p-8 text-center rounded-2xl bg-stone-900/30 border border-stone-800/40 space-y-1">
        <p className="text-xs font-medium text-stone-300">No sent requests</p>
        <p className="text-[11px] text-stone-400">
          When you request to connect with someone, your pending requests will show here.
        </p>
      </div>
    );
  }

  return (
    <div id="sent-requests-list" className="space-y-3">
      {error && (
        <div className="flex items-center gap-1.5 p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {requests.map((req) => {
        const recipient = req.recipient;
        const isBusy = cancellingId === req.id;
        const dateFormatted = new Date(req.created_at).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });

        return (
          <div
            key={req.id}
            id={`sent-request-${req.id}`}
            className="p-4 rounded-2xl bg-stone-900/70 border border-stone-800/80 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
                  {recipient?.avatar_url ? (
                    <img 
                      src={recipient.avatar_url} 
                      alt={recipient.display_name || recipient.username} 
                      className="w-full h-full object-cover" 
                    />
                  ) : (
                    <User className="w-5 h-5 text-stone-400" />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="text-xs font-semibold text-stone-100 truncate">
                    {recipient?.display_name || recipient?.username || 'Tchat Member'}
                  </div>
                  <div className="text-[11px] font-mono text-stone-400">
                    @{recipient?.username || 'member'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 text-[10px] text-stone-400 font-mono shrink-0">
                <Clock className="w-3 h-3 text-stone-400" />
                <span>{dateFormatted}</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-stone-950/60 border border-stone-800/50 text-xs text-stone-300">
              <div className="text-[10px] uppercase font-semibold text-stone-400 tracking-wider mb-0.5">
                Your Context Note
              </div>
              <p className="italic text-stone-300">"{req.context}"</p>
            </div>

            <div className="pt-1 flex justify-end">
              <button
                id={`btn-cancel-sent-${req.id}`}
                type="button"
                disabled={isBusy}
                onClick={() => handleCancel(req.id, req.recipient_id)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-stone-900 border border-stone-800 hover:border-rose-900/60 hover:text-rose-400 text-stone-400 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                <span>{isBusy ? 'Cancelling...' : 'Cancel Request'}</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
