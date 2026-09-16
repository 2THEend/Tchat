import React, { useState, useEffect } from 'react';
import { Phone, Check, X, Clock, AlertCircle } from 'lucide-react';
import { TchatCall } from '../../../domains/calls/types';
import { 
  formatCallReason, 
  getRemainingCallRequestSeconds, 
  isCallRequestExpired 
} from '../../../domains/calls/validation';
import { respondToCall, cancelCall } from '../../../domains/calls/callsService';

interface PendingCallBannerProps {
  call: TchatCall;
  currentUserId: string;
  partnerName: string;
  onCallUpdated: () => void;
}

export const PendingCallBanner: React.FC<PendingCallBannerProps> = ({
  call,
  currentUserId,
  partnerName,
  onCallUpdated,
}) => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    getRemainingCallRequestSeconds(call.request_expires_at)
  );

  const isRecipient = call.recipient_id === currentUserId;
  const isInitiator = call.initiator_id === currentUserId;

  // Countdown timer for pending immediate call request
  useEffect(() => {
    if (call.status !== 'pending') return;

    const interval = setInterval(() => {
      const remaining = getRemainingCallRequestSeconds(call.request_expires_at);
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onCallUpdated();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [call.request_expires_at, call.status, onCallUpdated]);

  if (call.status !== 'pending') {
    return null;
  }

  const isExpired = call.status === 'pending' && isCallRequestExpired(call);
  if (isExpired) return null;

  const handleAccept = async () => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await respondToCall(call.id, 'accept');
      if (res.error) {
        setActionError(res.error);
      } else {
        onCallUpdated();
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to accept call request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDecline = async () => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await respondToCall(call.id, 'decline');
      if (res.error) {
        setActionError(res.error);
      } else {
        onCallUpdated();
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to decline call request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await cancelCall(call.id);
      if (res.error) {
        setActionError(res.error);
      } else {
        onCallUpdated();
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel call request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formattedReason = formatCallReason(call);

  return (
    <div
      id={`pending-call-banner-${call.id}`}
      className="px-4 py-2.5 bg-stone-900/95 border-b border-stone-800/90 backdrop-blur-sm z-10 animate-in fade-in duration-150"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-stone-800 border border-stone-700/60 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
            <Phone className="w-4 h-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-stone-200">
                Immediate Call Request
              </span>
              {call.status === 'pending' ? (
                <span className="text-[11px] font-mono text-amber-400 bg-amber-950/40 border border-amber-800/40 px-1.5 py-0.5 rounded flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {remainingSeconds}s
                </span>
              ) : (
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-1.5 py-0.5 rounded">
                  Accepted
                </span>
              )}
            </div>

            <p className="text-xs text-stone-300 mt-0.5 truncate">
              {isRecipient
                ? `${partnerName}: ${formattedReason}`
                : `Sent to ${partnerName}: ${formattedReason}`}
            </p>

            {actionError && (
              <p className="text-[11px] text-rose-400 flex items-center gap-1 mt-1 font-mono">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {actionError}
              </p>
            )}
          </div>
        </div>

        {call.status === 'pending' && (
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            {isRecipient ? (
              <>
                <button
                  id="btn-accept-call-request"
                  type="button"
                  onClick={handleAccept}
                  disabled={isSubmitting}
                  aria-label="Accept call request"
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-900/60 hover:bg-emerald-800/80 border border-emerald-700/60 text-emerald-200 text-xs font-medium flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  Accept
                </button>
                <button
                  id="btn-decline-call-request"
                  type="button"
                  onClick={handleDecline}
                  disabled={isSubmitting}
                  aria-label="Decline call request"
                  className="px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 text-xs font-medium flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  Decline
                </button>
              </>
            ) : isInitiator ? (
              <button
                id="btn-cancel-call-request"
                type="button"
                onClick={handleCancel}
                disabled={isSubmitting}
                aria-label="Cancel call request"
                className="px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 text-xs font-medium flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
