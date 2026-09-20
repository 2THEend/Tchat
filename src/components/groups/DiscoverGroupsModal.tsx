import React, { useEffect, useState } from 'react';
import { 
  X, 
  Compass, 
  Search, 
  Users, 
  Clock, 
  ArrowRight, 
  Loader2, 
  Lock, 
  Globe 
} from 'lucide-react';
import { TchatGroup } from '../../domains/groups/types';
import { getDiscoverableGroups } from '../../domains/groups/groupsService';
import { formatGroupError } from '../../domains/groups/validation';

interface DiscoverGroupsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectGroup: (groupId: string) => void;
}

export function DiscoverGroupsModal({
  isOpen,
  onClose,
  onSelectGroup,
}: DiscoverGroupsModalProps) {
  const [groups, setGroups] = useState<TchatGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualGroupId, setManualGroupId] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    getDiscoverableGroups(20).then((res) => {
      if (!isMounted) return;
      if (res.error) {
        setError(formatGroupError(res.error));
      } else {
        setGroups(res.data || []);
      }
      setIsLoading(false);
    }).catch((err) => {
      if (!isMounted) return;
      setError(formatGroupError(err?.message));
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = manualGroupId.trim();
    if (cleanId) {
      onSelectGroup(cleanId);
      onClose();
    }
  };

  return (
    <div 
      id="discover-groups-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        id="discover-groups-modal-container"
        className="w-full max-w-md bg-stone-950 border border-stone-800/80 rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col overflow-hidden text-stone-100 shadow-2xl shadow-black animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-stone-900/80 flex items-center justify-between bg-stone-950/90 backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-center text-amber-400 shrink-0">
              <Compass className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-stone-100 truncate">
                Find Groups
              </h2>
              <p className="text-[11px] text-stone-400">
                Browse discoverable groups or enter an ID
              </p>
            </div>
          </div>

          <button
            id="btn-close-discover-modal"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
            aria-label="Close find groups"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Direct ID Lookup Form */}
          <form onSubmit={handleManualSubmit} className="space-y-1.5">
            <label 
              htmlFor="input-direct-group-id" 
              className="text-[11px] font-semibold text-stone-300 uppercase tracking-wider font-mono"
            >
              Enter Group ID
            </label>
            <div className="flex items-center gap-2">
              <input
                id="input-direct-group-id"
                type="text"
                value={manualGroupId}
                onChange={(e) => setManualGroupId(e.target.value)}
                placeholder="Paste group UUID..."
                className="flex-1 px-3.5 py-2 rounded-xl bg-stone-900 border border-stone-800 text-stone-100 placeholder:text-stone-400 text-xs focus:outline-none focus:border-stone-600 transition-colors font-mono"
              />
              <button
                id="btn-submit-direct-group-id"
                type="submit"
                disabled={!manualGroupId.trim()}
                className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold tracking-tight transition-colors cursor-pointer disabled:opacity-40 shrink-0"
              >
                Open
              </button>
            </div>
          </form>

          {/* Discoverable Section Header */}
          <div className="pt-2 border-t border-stone-900 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider font-mono">
              Discoverable Groups
            </span>
            <span className="text-[10px] text-stone-400 font-mono">
              {groups.length} available
            </span>
          </div>

          {isLoading ? (
            <div className="py-10 flex flex-col items-center justify-center gap-2 text-stone-400">
              <Loader2 className="w-6 h-6 animate-spin text-stone-300" />
              <span className="text-xs">Finding active groups...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-800/50 text-xs text-rose-300 space-y-1">
              <p className="font-semibold">Unable to load groups</p>
              <p className="text-[11px] text-rose-400/90">{error}</p>
            </div>
          ) : groups.length === 0 ? (
            <div className="py-10 text-center text-stone-400 text-xs space-y-1">
              <p>No discoverable groups currently active.</p>
              <p className="text-[11px] text-stone-400">Create one from Home to get started.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {groups.map((grp) => {
                const lifetimeLabel = grp.lifetime === '1_day' 
                  ? '1d' 
                  : grp.lifetime === '3_days' 
                  ? '3d' 
                  : '1w';

                return (
                  <div
                    key={grp.id}
                    id={`discover-group-${grp.id}`}
                    onClick={() => {
                      onSelectGroup(grp.id);
                      onClose();
                    }}
                    className="p-3.5 rounded-2xl bg-stone-900/50 border border-stone-800/70 hover:bg-stone-900/80 hover:border-stone-700/80 transition-all cursor-pointer space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {grp.cover_url ? (
                          <img 
                            src={grp.cover_url} 
                            alt={grp.name} 
                            className="w-9 h-9 rounded-xl object-cover shrink-0 border border-stone-800"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-400 shrink-0">
                            <Users className="w-4 h-4" />
                          </div>
                        )}

                        <div className="min-w-0">
                          <h3 className="text-xs font-semibold text-stone-100 truncate">
                            {grp.name}
                          </h3>
                          <p className="text-[11px] text-stone-400 truncate">
                            {grp.reason}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] font-mono text-amber-400 bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{lifetimeLabel}</span>
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-stone-500 ml-1" />
                      </div>
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
            id="btn-dismiss-discover-modal"
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
