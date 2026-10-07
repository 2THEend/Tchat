import React, { useState, useEffect } from 'react';
import { Phone, Check, X, Clock, AlertCircle } from 'lucide-react';
import { TchatCall, TchatIncomingCall, TchatCallerProfile } from '../../../domains/calls/types';
import {
  formatCallReason,
  getRemainingCallRequestSeconds,
  isPendingIncomingCallForUser,
} from '../../../domains/calls/validation';
import { respondToCall } from '../../../domains/calls/callsService';

interface GlobalIncomingCallBannerProps {
  call: TchatIncomingCall;
  currentUserId: string;
  onAccept: (acceptedCall: TchatCall, callerProfile?: TchatCallerProfile | null) => void;
  onDismiss: () => void;
}

export const GlobalIncomingCallBanner: React.FC<GlobalIncomingCallBannerProps> = ({
  call,
  currentUserId,
  onAccept,
  onDismiss,
}) => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    getRemainingCallRequestSeconds(call.request_expires_at)
  );

  useEffect(() => {
    setRemainingSeconds(getRemainingCallRequestSeconds(call.request_expires_at));
    if (call.status !== 'pending') return;

    const interval = setInterval(() => {
      const remaining = getRemainingCallRequestSeconds(call.request_expires_at);
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onDismiss();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [call.id, call.request_expires_at, call.status, onDismiss]);

  if (!isPendingIncomingCallForUser(call, currentUserId) || remainingSeconds <= 0) {
    return null;
  }

  const callerProfile = call.caller_profile;
  const callerName = callerProfile?.display_name || callerProfile?.username || 'Connection';
  const callerUsername = callerProfile?.username ? `@${callerProfile.username}` : null;
  const reasonDisplay = formatCallReason(call);
  const modeLabel = call.mode === 'scheduled' ? 'Scheduled' : 'Immediate';

  const handleAccept = async () => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await respondToCall(call.id, 'accept');
      if (res.error) {
        setActionError(res.error);
        if (
          res.error.toLowerCase().includes('expired') ||
          res.error.toLowerCase().includes('no longer pending')
        ) {
          onDismiss();
        }
      } else if (res.data) {
        onAccept(res.data, callerProfile);
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to accept call.');
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
        if (
          res.error.toLowerCase().includes('expired') ||
          res.error.toLowerCase().includes('no longer pending')
        ) {
          onDismiss();
        }
      } else {
        onDismiss();
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to decline call.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="global-incoming-call-banner"
      role="region"
      aria-label="Incoming call request"
      className="px-4 py-3 bg-stone-900/95 border-b border-stone-800/90 flex flex-col gap-2 shrink-0 z-40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-emerald-950/60 border border-emerald-800/50 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
            <Phone className="w-4 h-4 animate-pulse" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-stone-100 truncate">
                {callerName}
              </span>
              {callerUsername && (
                <span className="text-[10px] font-mono text-stone-400">
                  {callerUsername}
                </span>
              )}
              <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-stone-800 text-stone-300 border border-stone-700/60">
                {modeLabel}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-stone-400 bg-stone-950 px-1.5 py-0.5 rounded border border-stone-800">
                <Clock className="w-2.5 h-2.5 text-amber-400" />
                <span>{remainingSeconds}s</span>
              </span>
            </div>

            <div className="mt-1">
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-1.5 py-0.5 rounded inline-block break-words">
                Context: {reasonDisplay}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            id="btn-global-call-accept"
            type="button"
            disabled={isSubmitting}
            onClick={handleAccept}
            aria-label="Accept incoming call"
            className="px-2.5 py-1.5 rounded-lg bg-emerald-900/60 hover:bg-emerald-800/80 border border-emerald-700/60 text-emerald-200 text-xs font-medium flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Accept</span>
          </button>

          <button
            id="btn-global-call-decline"
            type="button"
            disabled={isSubmitting}
            onClick={handleDecline}
            aria-label="Decline incoming call"
            className="px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 text-xs font-medium flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Decline</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="flex items-center gap-1.5 text-[11px] text-rose-400 bg-rose-950/30 border border-rose-900/50 rounded-lg px-2.5 py-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}
    </div>
  );
};
