import React from 'react';
import { MessageSquare, Camera, Video, Plus } from 'lucide-react';
import { TchatStreak, StreakType } from '../../../domains/streaks/types';

interface StreakBadgesProps {
  streaks: TchatStreak[];
  onOpenModal: () => void;
  hasPending: boolean;
}

export function getStreakTypeIcon(type: StreakType, className = 'w-3.5 h-3.5') {
  switch (type) {
    case 'chat':
      return <MessageSquare className={className} />;
    case 'photo':
      return <Camera className={className} />;
    case 'video':
      return <Video className={className} />;
  }
}

export function formatStreakType(type: StreakType): string {
  switch (type) {
    case 'chat':
      return 'Chat';
    case 'photo':
      return 'Photo';
    case 'video':
      return 'Video';
  }
}

export function formatStreakDays(count: number): string {
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

export const StreakBadges: React.FC<StreakBadgesProps> = ({
  streaks,
  onOpenModal,
  hasPending,
}) => {
  // Only display active or dormant streaks in the summary chips
  const activeOrDormant = streaks.filter(
    (s) => s.state === 'active' || s.state === 'dormant'
  );

  return (
    <div
      id="streak-badges-bar"
      className="flex items-center gap-1.5 px-4 py-1.5 bg-stone-950/80 border-b border-stone-800/60 overflow-x-auto scrollbar-none text-xs"
    >
      {activeOrDormant.length === 0 ? (
        <button
          id="btn-start-streak-inline"
          type="button"
          onClick={onOpenModal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-900/90 hover:bg-stone-800/90 text-stone-400 hover:text-stone-200 border border-stone-800 transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Start a Streak</span>
          {hasPending && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ml-0.5" title="Pending request" />
          )}
        </button>
      ) : (
        <>
          {activeOrDormant.map((streak) => {
            const isDormant = streak.state === 'dormant';
            return (
              <button
                key={streak.id}
                id={`btn-streak-badge-${streak.type}`}
                type="button"
                onClick={onOpenModal}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors cursor-pointer shrink-0 ${
                  isDormant
                    ? 'bg-stone-900/60 border-stone-800 text-stone-400 hover:text-stone-200'
                    : 'bg-stone-900/90 border-stone-800/90 text-stone-200 hover:bg-stone-850'
                }`}
              >
                <span className="text-stone-400 shrink-0">
                  {getStreakTypeIcon(streak.type, 'w-3 h-3')}
                </span>
                <span className="font-medium">{formatStreakType(streak.type)}</span>
                <span className="text-stone-500">·</span>
                <span>{formatStreakDays(streak.progress_count)}</span>
                {isDormant ? (
                  <span className="text-[10px] text-stone-400 font-mono px-1 py-0.2 rounded bg-stone-800/80 ml-0.5">
                    Dormant
                  </span>
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/90 ml-0.5" />
                )}
              </button>
            );
          })}

          {/* If there are fewer than 3 streak types active, show a subtle + button */}
          {activeOrDormant.length < 3 && (
            <button
              id="btn-more-streaks"
              type="button"
              onClick={onOpenModal}
              title="Manage or start more streaks"
              className="p-1 rounded-lg text-stone-500 hover:text-stone-300 hover:bg-stone-900 transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}

          {hasPending && (
            <button
              id="btn-pending-indicator"
              type="button"
              onClick={onOpenModal}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-950/40 border border-amber-800/40 text-amber-300 text-[11px] cursor-pointer shrink-0 ml-auto"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>Pending</span>
            </button>
          )}
        </>
      )}
    </div>
  );
};
