import React, { useState } from 'react';
import { X, Check, Clock, AlertCircle, Info, Sparkles } from 'lucide-react';
import { TchatStreak, StreakType } from '../../../domains/streaks/types';
import { initiateStreak, endStreak } from '../../../domains/streaks/streaksService';
import { canEndStreak } from '../../../domains/streaks/validation';
import { formatStreakType, formatStreakDays, getStreakTypeIcon } from './StreakBadges';

interface StreaksModalProps {
  isOpen: boolean;
  onClose: () => void;
  streaks: TchatStreak[];
  conversationId: string;
  partnerName: string;
  currentUserId: string;
  onStreakUpdated: () => void;
}

export const StreaksModal: React.FC<StreaksModalProps> = ({
  isOpen,
  onClose,
  streaks,
  conversationId,
  partnerName,
  currentUserId,
  onStreakUpdated,
}) => {
  const [selectedType, setSelectedType] = useState<StreakType | null>(null);
  const [isInitiating, setIsInitiating] = useState<boolean>(false);
  const [confirmingEndStreakId, setConfirmingEndStreakId] = useState<string | null>(null);
  const [isEnding, setIsEnding] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // Active / Dormant / Pending streaks
  const activeOrDormant = streaks.filter(
    (s) => s.state === 'active' || s.state === 'dormant'
  );
  const pendingStreaks = streaks.filter((s) => s.state === 'pending');
  const endedStreaks = streaks.filter((s) => s.state === 'ended');

  // Determine available types not currently active, dormant, or pending
  const occupiedTypes = new Set(
    streaks
      .filter((s) => s.state !== 'ended')
      .map((s) => s.type)
  );

  const allTypes: StreakType[] = ['chat', 'photo', 'video'];
  const availableTypes = allTypes.filter((t) => !occupiedTypes.has(t));

  const handleInitiate = async (type: StreakType) => {
    setIsInitiating(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await initiateStreak(conversationId, type);
      if (res.error) {
        setErrorMessage(res.error);
      } else {
        setSuccessMessage(`Requested ${formatStreakType(type)} Streak. Awaiting ${partnerName}'s acceptance.`);
        setSelectedType(null);
        onStreakUpdated();
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to request streak.');
    } finally {
      setIsInitiating(false);
    }
  };

  const handleEndStreak = async (streak: TchatStreak) => {
    setIsEnding(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await endStreak(streak.id, streak);
      if (res.error) {
        setErrorMessage(res.error);
      } else {
        setSuccessMessage(`Ended ${formatStreakType(streak.type)} Streak. Historical progress is preserved.`);
        setConfirmingEndStreakId(null);
        onStreakUpdated();
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to end streak.');
    } finally {
      setIsEnding(false);
    }
  };

  const getTypeDescription = (type: StreakType) => {
    switch (type) {
      case 'chat':
        return 'Both participants send at least one text message on their local calendar day.';
      case 'photo':
        return 'Both participants send at least one ephemeral photo.';
      case 'video':
        return 'Both participants send at least one ephemeral video.';
    }
  };

  return (
    <div
      id="streaks-modal-backdrop"
      className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="streaks-modal-sheet"
        className="w-full sm:max-w-md bg-stone-900 border border-stone-800 rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[85vh] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-stone-100 flex items-center gap-2">
              <span>Streaks</span>
            </h2>
            <p className="text-xs text-stone-400 mt-0.5">
              Intentional continuity with {partnerName}
            </p>
          </div>
          <button
            id="btn-close-streaks-modal"
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Notifications / Alerts */}
          {errorMessage && (
            <div className="p-3 bg-rose-950/50 border border-rose-900/60 rounded-xl text-rose-200 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="flex-1">{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-950/50 border border-emerald-900/60 rounded-xl text-emerald-200 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="flex-1">{successMessage}</span>
            </div>
          )}

          {/* Current Active & Dormant Streaks */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-3">
              Current Continuity
            </h3>

            {activeOrDormant.length === 0 && pendingStreaks.length === 0 ? (
              <div className="p-4 rounded-xl bg-stone-950/50 border border-stone-800/80 text-center">
                <p className="text-xs text-stone-400">
                  No active streaks with {partnerName} yet.
                </p>
                <p className="text-[11px] text-stone-500 mt-1">
                  Streaks are initiated intentionally and require mutual agreement.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {activeOrDormant.map((streak) => {
                  const isDormant = streak.state === 'dormant';
                  const isConfirmingEnd = confirmingEndStreakId === streak.id;

                  return (
                    <div
                      key={streak.id}
                      id={`streak-card-${streak.type}`}
                      className="p-3.5 rounded-xl bg-stone-950/60 border border-stone-800/80 flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-stone-800/90 border border-stone-700/60 flex items-center justify-center text-stone-300">
                            {getStreakTypeIcon(streak.type, 'w-4 h-4')}
                          </div>
                          <div>
                            <span className="text-sm font-medium text-stone-200">
                              {formatStreakType(streak.type)} Streak
                            </span>
                            <div className="text-xs font-semibold text-stone-100">
                              {formatStreakDays(streak.progress_count)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isDormant ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-stone-800 border border-stone-700 text-stone-300 text-xs font-medium">
                              <Clock className="w-3 h-3 text-stone-400" />
                              <span>Dormant</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-xs font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              <span>Active</span>
                            </span>
                          )}

                          {canEndStreak(streak.state) && !isConfirmingEnd && (
                            <button
                              id={`btn-end-streak-${streak.type}`}
                              type="button"
                              onClick={() => setConfirmingEndStreakId(streak.id)}
                              aria-label={`End ${formatStreakType(streak.type)} Streak`}
                              className="px-2.5 py-1 rounded-md text-[11px] font-medium text-stone-400 hover:text-rose-300 bg-stone-900 hover:bg-rose-950/30 border border-stone-800 hover:border-rose-900/50 transition-colors cursor-pointer"
                            >
                              End Streak
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Inline Confirmation */}
                      {isConfirmingEnd && (
                        <div
                          id={`confirm-end-streak-${streak.type}`}
                          className="p-3 rounded-lg bg-stone-900 border border-stone-700/80 space-y-2 mt-1 animate-in fade-in duration-150"
                        >
                          <div className="flex items-start gap-2 text-stone-300 text-xs">
                            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div className="space-y-0.5">
                              <p className="font-medium text-stone-200">
                                Permanently end {formatStreakType(streak.type)} Streak?
                              </p>
                              <p className="text-[11px] text-stone-400">
                                Accumulated history ({formatStreakDays(streak.progress_count)}) will be preserved, but this streak cannot be resumed.
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              id={`btn-confirm-end-streak-${streak.type}`}
                              type="button"
                              onClick={() => handleEndStreak(streak)}
                              disabled={isEnding}
                              className="px-3 py-1.5 rounded-md bg-rose-900/80 hover:bg-rose-800 text-rose-100 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {isEnding ? 'Ending...' : 'Confirm End'}
                            </button>
                            <button
                              id={`btn-cancel-end-streak-${streak.type}`}
                              type="button"
                              onClick={() => setConfirmingEndStreakId(null)}
                              disabled={isEnding}
                              className="px-3 py-1.5 rounded-md bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* State Context Message */}
                      {!isConfirmingEnd && (
                        <div className="text-[11px] text-stone-400 border-t border-stone-800/60 pt-2 flex items-start gap-1.5">
                          <Info className="w-3.5 h-3.5 text-stone-500 shrink-0 mt-0.5" />
                          {isDormant ? (
                            <span>
                              Progress is preserved. Missing days do not erase previous progress. Another mutual qualifying day will reactivate this streak.
                            </span>
                          ) : (
                            <span>
                              {streak.has_qualifying_today
                                ? `You've sent a qualifying ${streak.type} today.`
                                : `Send a qualifying ${streak.type} today to maintain continuity.`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Pending requests overview */}
                {pendingStreaks.map((streak) => {
                  const isInitiator = streak.initiator_id === currentUserId;
                  return (
                    <div
                      key={streak.id}
                      className="p-3 rounded-xl bg-stone-950/40 border border-amber-800/30 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-stone-800 flex items-center justify-center text-stone-400">
                          {getStreakTypeIcon(streak.type, 'w-3.5 h-3.5')}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-stone-300">
                            {formatStreakType(streak.type)} Streak
                          </p>
                          <p className="text-[11px] text-stone-500">
                            {isInitiator
                              ? 'Request sent · Awaiting acceptance'
                              : `${partnerName} invited you`}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded">
                        Pending
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Start a Streak Section */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-3">
              Start a Streak
            </h3>

            {availableTypes.length === 0 ? (
              <div className="p-3.5 rounded-xl bg-stone-950/40 border border-stone-800 text-xs text-stone-400 text-center">
                All streak types (Chat, Photo, Video) are currently active or pending.
              </div>
            ) : (
              <div className="space-y-2">
                {availableTypes.map((type) => {
                  const isSelected = selectedType === type;
                  return (
                    <div
                      key={type}
                      className={`p-3 rounded-xl border transition-colors ${
                        isSelected
                          ? 'bg-stone-850 border-stone-700'
                          : 'bg-stone-950/40 border-stone-800/80 hover:border-stone-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-stone-800 flex items-center justify-center text-stone-300">
                            {getStreakTypeIcon(type, 'w-4 h-4')}
                          </div>
                          <div>
                            <div className="text-xs font-medium text-stone-200">
                              {formatStreakType(type)} Streak
                            </div>
                            <div className="text-[11px] text-stone-400 leading-snug mt-0.5">
                              {getTypeDescription(type)}
                            </div>
                          </div>
                        </div>

                        <button
                          id={`btn-request-streak-${type}`}
                          type="button"
                          onClick={() => handleInitiate(type)}
                          disabled={isInitiating}
                          className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-white text-stone-950 text-xs font-medium transition-colors shrink-0 disabled:opacity-50 cursor-pointer"
                        >
                          {isInitiating && selectedType === type ? 'Requesting...' : 'Request'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Principle Clarifications */}
          <div className="p-3.5 rounded-xl bg-stone-950/30 border border-stone-800/50 space-y-1.5 text-[11px] text-stone-400">
            <div className="font-semibold text-stone-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-stone-400" />
              <span>Streak Principles</span>
            </div>
            <p>• Both people must participate on their respective local days to earn +1 day.</p>
            <p>• Missing a day pauses progress as Dormant; previous progress is never lost.</p>
            <p>• Multiple messages on the same day do not produce extra progress.</p>
          </div>

          {/* Ended Streaks (Minimal historical record) */}
          {endedStreaks.length > 0 && (
            <div id="ended-streaks-section">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">
                Ended Streaks
              </h3>
              <div className="space-y-1.5">
                {endedStreaks.map((streak) => (
                  <div
                    key={streak.id}
                    id={`streak-card-ended-${streak.type}`}
                    className="px-3.5 py-2.5 rounded-xl bg-stone-950/40 border border-stone-800/60 flex items-center justify-between text-xs text-stone-400"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-stone-800 flex items-center justify-center text-stone-400">
                        {getStreakTypeIcon(streak.type, 'w-3.5 h-3.5')}
                      </div>
                      <div>
                        <span className="font-medium text-stone-300">
                          {formatStreakType(streak.type)} Streak
                        </span>
                        <span className="text-stone-500 text-[11px] block">
                          {streak.end_reason === 'manual_ended'
                            ? 'Manually ended'
                            : streak.end_reason === 'declined'
                            ? 'Declined'
                            : streak.end_reason === 'cancelled'
                            ? 'Cancelled'
                            : 'Ended'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-stone-300">
                        {formatStreakDays(streak.progress_count)}
                      </span>
                      <span className="text-[10px] text-stone-500 block uppercase font-mono">
                        Preserved
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-stone-800 bg-stone-950/40 shrink-0">
          <button
            id="btn-close-streaks-modal-bottom"
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
