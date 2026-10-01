import React, { useEffect, useState } from 'react';
import { X, Users, Loader2, User as UserIcon } from 'lucide-react';
import { CircleMember } from '../../domains/groups/types';
import { listCircleMembers } from '../../domains/groups/circlesService';

interface CircleMembersModalProps {
  circleId: string;
  circleName: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenProfile?: (userId: string) => void;
}

export function CircleMembersModal({
  circleId,
  circleName,
  isOpen,
  onClose,
  onOpenProfile,
}: CircleMembersModalProps) {
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    listCircleMembers(circleId).then((res) => {
      if (!isMounted) return;
      setIsLoading(false);
      if (res.data) setMembers(res.data);
      if (res.error) setError(res.error);
    });

    return () => {
      isMounted = false;
    };
  }, [circleId, isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      id="circle-members-modal-overlay"
      className="fixed inset-0 z-50 bg-stone-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
    >
      <div 
        id="circle-members-modal-container"
        className="w-full sm:max-w-md bg-stone-900 border-t sm:border border-stone-800 rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl space-y-4 max-h-[80vh] flex flex-col animate-in slide-in-from-bottom duration-200"
      >
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-stone-100">
              Members in {circleName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-stone-500 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Loading members...</span>
            </div>
          ) : error ? (
            <div className="p-3 rounded-xl bg-rose-950/30 text-rose-300 text-xs">
              {error}
            </div>
          ) : members.length === 0 ? (
            <p className="text-xs text-stone-500 text-center py-6">No members in this circle yet.</p>
          ) : (
            members.map((m) => (
              <button 
                key={m.user_id}
                type="button"
                onClick={() => onOpenProfile?.(m.user_id)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-stone-950/60 hover:bg-stone-950 border border-stone-800/80 text-left transition-colors cursor-pointer"
                title={`View ${m.display_name}'s profile`}
              >
                <div className="w-8 h-8 rounded-full bg-stone-800 border border-stone-700 overflow-hidden flex items-center justify-center shrink-0">
                  {m.avatar_url ? (
                    <img 
                      src={m.avatar_url} 
                      alt={m.display_name} 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <UserIcon className="w-4 h-4 text-stone-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-stone-200 truncate">
                    {m.display_name}
                  </div>
                  <div className="text-[10px] text-stone-500 truncate">
                    @{m.username}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
