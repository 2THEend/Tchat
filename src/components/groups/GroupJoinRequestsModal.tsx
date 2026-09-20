import React, { useEffect, useState } from 'react';
import { 
  X, 
  Inbox, 
  Check, 
  X as XIcon, 
  Loader2, 
  HelpCircle,
  Clock,
  User as UserIcon 
} from 'lucide-react';
import { TchatGroupJoinRequest } from '../../domains/groups/types';
import { 
  getGroupJoinRequests, 
  approveGroupJoinRequest, 
  declineGroupJoinRequest 
} from '../../domains/groups/groupsService';
import { formatGroupError } from '../../domains/groups/validation';

interface GroupJoinRequestsModalProps {
  groupId: string;
  groupName: string;
  isOpen: boolean;
  onClose: () => void;
  onRequestProcessed: () => void;
}

export function GroupJoinRequestsModal({
  groupId,
  groupName,
  isOpen,
  onClose,
  onRequestProcessed,
}: GroupJoinRequestsModalProps) {
  const [requests, setRequests] = useState<TchatGroupJoinRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchRequests = async () => {
    setIsLoading(true);
    setError(null);

    const res = await getGroupJoinRequests(groupId);
    if (res.error) {
      setError(formatGroupError(res.error));
    } else {
      setRequests(res.data || []);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchRequests();
  }, [groupId, isOpen]);

  if (!isOpen) return null;

  const handleApprove = async (requestId: string) => {
    if (!requestId) {
      setActionError('Invalid join request identifier.');
      return;
    }

    setProcessingId(requestId);
    setActionError(null);

    const res = await approveGroupJoinRequest(requestId, groupId);
    if (res.error) {
      setActionError(formatGroupError(res.error));
      setProcessingId(null);
    } else {
      setRequests((prev) => prev.filter((r) => r.id !== requestId && r.request_id !== requestId));
      setProcessingId(null);
      onRequestProcessed();
    }
  };

  const handleDecline = async (requestId: string) => {
    if (!requestId) {
      setActionError('Invalid join request identifier.');
      return;
    }

    setProcessingId(requestId);
    setActionError(null);

    const res = await declineGroupJoinRequest(requestId, groupId);
    if (res.error) {
      setActionError(formatGroupError(res.error));
      setProcessingId(null);
    } else {
      setRequests((prev) => prev.filter((r) => r.id !== requestId && r.request_id !== requestId));
      setProcessingId(null);
      onRequestProcessed();
    }
  };

  return (
    <div 
      id="group-join-requests-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        id="group-join-requests-modal-container"
        className="w-full max-w-md bg-stone-950 border border-stone-800/80 rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col overflow-hidden text-stone-100 shadow-2xl shadow-black animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-stone-900/80 flex items-center justify-between bg-stone-950/90 backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-950/60 border border-amber-800/60 flex items-center justify-center text-amber-300 shrink-0">
              <Inbox className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-stone-100 truncate">
                Join Requests
              </h2>
              <p className="text-[11px] text-stone-400">
                {groupName} • {requests.length} pending
              </p>
            </div>
          </div>

          <button
            id="btn-close-requests-modal"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
            aria-label="Close join requests"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Action Error Banner */}
        {actionError && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-rose-950/50 border border-rose-800/60 text-xs text-rose-300 flex items-center justify-between gap-2">
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-rose-400 hover:text-rose-200 cursor-pointer text-[10px]"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-stone-400">
              <Loader2 className="w-6 h-6 animate-spin text-stone-300" />
              <span className="text-xs">Loading pending requests...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-800/50 text-xs text-rose-300 space-y-1">
              <p className="font-semibold">Unable to load requests</p>
              <p className="text-[11px] text-rose-400/90">{error}</p>
            </div>
          ) : requests.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-center text-stone-400">
              <div className="w-10 h-10 rounded-2xl bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-500">
                <Inbox className="w-5 h-5" />
              </div>
              <p className="text-xs font-medium text-stone-300">No pending join requests</p>
              <p className="text-[11px] text-stone-400">
                New applicants will appear here for review.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map((req) => {
                const reqId = req.id || req.request_id || '';
                const isBusy = processingId === reqId;
                const createdFormatted = new Date(req.created_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={reqId}
                    id={`request-item-${reqId}`}
                    className="p-4 rounded-2xl bg-stone-900/50 border border-stone-800/70 space-y-3 hover:bg-stone-900/70 transition-colors"
                  >
                    {/* Requester Identity */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {req.avatar_url ? (
                          <img
                            src={req.avatar_url}
                            alt={req.display_name || req.username || 'Applicant'}
                            className="w-9 h-9 rounded-xl object-cover border border-stone-700/60 shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-400 shrink-0">
                            <UserIcon className="w-4 h-4" />
                          </div>
                        )}

                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-stone-200 truncate">
                            {req.display_name || req.username || 'Applicant'}
                          </p>
                          {req.username && (
                            <p className="text-[11px] text-stone-400 font-mono truncate">
                              @{req.username}
                            </p>
                          )}
                        </div>
                      </div>

                      <span className="text-[10px] text-stone-400 font-mono shrink-0 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-stone-400" />
                        <span>{createdFormatted}</span>
                      </span>
                    </div>

                    {/* Question Answer (if present) */}
                    {req.question_answer && (
                      <div className="p-2.5 rounded-xl bg-stone-950/60 border border-stone-800/80 space-y-1">
                        <span className="text-[10px] text-amber-400 font-medium uppercase tracking-wide flex items-center gap-1">
                          <HelpCircle className="w-3 h-3" />
                          <span>Submitted Answer</span>
                        </span>
                        <p className="text-xs text-stone-200 italic leading-relaxed">
                          "{req.question_answer}"
                        </p>
                      </div>
                    )}

                    {/* Action Controls */}
                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-stone-800/50">
                      <button
                        id={`btn-decline-request-${reqId}`}
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDecline(reqId)}
                        className="px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-rose-300 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <XIcon className="w-3.5 h-3.5" />
                        )}
                        <span>Decline</span>
                      </button>

                      <button
                        id={`btn-approve-request-${reqId}`}
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleApprove(reqId)}
                        className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold tracking-tight transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1 shadow-sm shadow-emerald-950"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>Approve</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="p-4 border-t border-stone-900/80 bg-stone-950/80">
          <button
            id="btn-dismiss-requests-modal"
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-stone-100 text-xs font-medium transition-colors cursor-pointer text-center"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
