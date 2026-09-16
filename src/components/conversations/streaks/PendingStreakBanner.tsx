import React, { useState } from 'react';
import { AlertCircle, Check, X } from 'lucide-react';
import { TchatStreak } from '../../../domains/streaks/types';
import { 
  acceptStreak, 
  declineStreak, 
  cancelStreak 
} from '../../../domains/streaks/streaksService';
import { formatStreakType, getStreakTypeIcon } from './StreakBadges';

interface PendingStreakBannerProps {
  streak: TchatStreak;
  currentUserId: string;
  partnerName: string;
  onStreakUpdated: () => void;
}

export const PendingStreakBanner: React.FC<PendingStreakBannerProps> = ({
  streak,
  currentUserId,
  partnerName,
  onStreakUpdated,
}) => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isRecipient = streak.recipient_id === currentUserId;
  const isInitiator = streak.initiator_id === currentUserId;

  if (streak.state !== 'pending') return null;

  const handleAccept = async () => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await acceptStreak(streak.id);
      if (res.error) {
        setActionError(res.error);
      } else {
        onStreakUpdated();
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to accept streak.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDecline = async () => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await declineStreak(streak.id);
      if (res.error) {
        setActionError(res.error);
      } else {
        onStreakUpdated();
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to decline streak.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await cancelStreak(streak.id);
      if (res.error) {
        setActionError(res.error);
      } else {
        onStreakUpdated();
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to cancel streak request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const typeName = formatStreakType(streak.type);

  return (
    <div
      id={`pending-streak-banner-${streak.id}`}
      className="px-4 py-2.5 bg-stone-900/90 border-b border-stone-800/80 backdrop-blur-sm z-10"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 shrink-0 mt-0.5">
            {getStreakTypeIcon(streak.type, 'w-4 h-4')}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-stone-200">
                {typeName} Streak
              </span>
              <span className="text-[11px] font-mono text-amber-400 bg-amber-950/40 border border-amber-800/40 px-1.5 py-0.2 rounded">
                Pending
              </span>
            </div>

            {isRecipient ? (
              <p className="text-xs text-stone-300 mt-0.5 leading-relaxed">
                <span className="font-medium text-stone-100">{partnerName}</span> invited you to start a {typeName} Streak. Progress begins once accepted.
              </p>
            ) : isInitiator ? (
              <p className="text-xs text-stone-300 mt-0.5 leading-relaxed">
                You requested a {typeName} Streak. Awaiting response from {partnerName}.
              </p>
            ) : null}

            {actionError && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-rose-300">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {isRecipient && (
            <>
              <button
                id={`btn-accept-streak-${streak.id}`}
                type="button"
                onClick={handleAccept}
                disabled={isSubmitting}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-white text-stone-950 font-medium text-xs transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Accept</span>
              </button>
              <button
                id={`btn-decline-streak-${streak.id}`}
                type="button"
                onClick={handleDecline}
                disabled={isSubmitting}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800/80 text-xs transition-colors disabled:opacity-50 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Decline</span>
              </button>
            </>
          )}

          {isInitiator && (
            <button
              id={`btn-cancel-streak-${streak.id}`}
              type="button"
              onClick={handleCancel}
              disabled={isSubmitting}
              className="px-2.5 py-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800/80 text-xs transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
