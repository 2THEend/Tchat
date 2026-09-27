import React, { useEffect, useState } from 'react';
import { Sparkles, Plus, Clock, Users, ArrowRight, Loader2 } from 'lucide-react';
import { TchatCircle } from '../../domains/groups/types';
import { getGroupCircles } from '../../domains/groups/circlesService';
import { onGroupEvent } from '../../domains/groups/events';

interface GroupCirclesContextBarProps {
  groupId: string;
  isGroupActive: boolean;
  onOpenCreateCircle: () => void;
  onSelectCircle: (circle: TchatCircle) => void;
}

export function GroupCirclesContextBar({
  groupId,
  isGroupActive,
  onOpenCreateCircle,
  onSelectCircle,
}: GroupCirclesContextBarProps) {
  const [circles, setCircles] = useState<TchatCircle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCircles = async () => {
    const res = await getGroupCircles(groupId);
    if (res.data) {
      setCircles(res.data);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCircles();

    const unsub = onGroupEvent((evt) => {
      if (evt.groupId === groupId && (evt.type === 'group:circle_created' || evt.type === 'group:refreshed')) {
        fetchCircles();
      }
    });

    return unsub;
  }, [groupId]);

  const formatRemaining = (expiresAt: string) => {
    const diffMs = new Date(expiresAt).getTime() - Date.now();
    if (diffMs <= 0) return 'expired';
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h left`;
    return `${Math.max(1, mins)}m left`;
  };

  return (
    <div 
      id="group-circles-context-bar"
      className="shrink-0 bg-stone-900/60 border-b border-stone-800/70 px-4 py-2.5 flex items-center justify-between gap-3 overflow-x-auto select-none"
    >
      <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar py-0.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-400 shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Circles</span>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-1.5 text-xs text-stone-500 px-2 py-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Loading circles...</span>
          </div>
        ) : circles.length === 0 ? (
          <span className="text-[11px] text-stone-500 italic shrink-0">
            No active circles right now
          </span>
        ) : (
          circles.map((circle) => {
            const remainingLabel = formatRemaining(circle.expires_at);
            return (
              <button
                key={circle.id}
                type="button"
                onClick={() => onSelectCircle(circle)}
                className={`flex items-center gap-2 px-2.5 py-1 rounded-xl text-xs font-medium border transition-colors shrink-0 cursor-pointer ${
                  circle.is_member
                    ? 'bg-amber-950/60 border-amber-700/60 text-amber-200 hover:bg-amber-950/80'
                    : 'bg-stone-950/70 border-stone-800 text-stone-300 hover:bg-stone-900 hover:border-stone-700'
                }`}
                title={circle.reason || circle.name}
              >
                <span className="truncate max-w-[120px]">{circle.name}</span>
                <span className="flex items-center gap-1 text-[10px] text-stone-400 font-mono">
                  <Users className="w-2.5 h-2.5" />
                  <span>{circle.member_count}</span>
                </span>
                <span className="flex items-center gap-1 text-[10px] text-amber-400/90 font-mono">
                  <Clock className="w-2.5 h-2.5" />
                  <span>{remainingLabel}</span>
                </span>
                <ArrowRight className="w-2.5 h-2.5 text-stone-500" />
              </button>
            );
          })
        )}
      </div>

      {/* Start Circle Button */}
      {isGroupActive && (
        <button
          type="button"
          onClick={onOpenCreateCircle}
          className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-stone-800/80 hover:bg-stone-800 text-stone-200 text-xs font-medium border border-stone-700/60 transition-colors shrink-0 cursor-pointer"
          title="Start a temporary circle"
        >
          <Plus className="w-3.5 h-3.5 text-amber-400" />
          <span>New Circle</span>
        </button>
      )}
    </div>
  );
}
