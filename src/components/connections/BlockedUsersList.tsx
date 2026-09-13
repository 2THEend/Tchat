import { useState } from 'react';
import { User, ShieldOff, AlertCircle } from 'lucide-react';
import { TchatBlock } from '../../domains/connections/types';

interface BlockedUsersListProps {
  blocks: TchatBlock[];
  onUnblock: (targetUserId: string) => Promise<void>;
  isLoading: boolean;
}

export function BlockedUsersList({
  blocks,
  onUnblock,
  isLoading,
}: BlockedUsersListProps) {
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUnblock = async (blockedId: string) => {
    setUnblockingId(blockedId);
    setError(null);
    try {
      await onUnblock(blockedId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to unblock user.';
      setError(msg);
    } finally {
      setUnblockingId(null);
    }
  };

  if (blocks.length === 0 && !isLoading) {
    return (
      <div id="blocked-empty" className="p-8 text-center rounded-2xl bg-stone-900/30 border border-stone-800/40 space-y-1">
        <p className="text-xs font-medium text-stone-300">No blocked users</p>
        <p className="text-[11px] text-stone-400">
          When you block someone for safety or privacy reasons, they will appear here.
        </p>
      </div>
    );
  }

  return (
    <div id="blocked-users-list" className="space-y-3">
      {error && (
        <div className="flex items-center gap-1.5 p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {blocks.map((block) => {
        const target = block.blocked_user;
        const targetId = block.blocked_id;
        const isBusy = unblockingId === targetId;

        return (
          <div
            key={block.id}
            id={`blocked-card-${block.id}`}
            className="p-4 rounded-2xl bg-stone-900/70 border border-stone-800/80 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-400 overflow-hidden shrink-0">
                {target?.avatar_url ? (
                  <img 
                    src={target.avatar_url} 
                    alt={target.display_name || target.username} 
                    className="w-full h-full object-cover grayscale opacity-60" 
                  />
                ) : (
                  <User className="w-5 h-5 text-stone-500" />
                )}
              </div>

              <div className="min-w-0">
                <div className="text-xs font-semibold text-stone-300 truncate">
                  {target?.display_name || target?.username || 'Blocked User'}
                </div>
                <div className="text-[11px] font-mono text-stone-500">
                  @{target?.username || 'user'}
                </div>
              </div>
            </div>

            <button
              id={`btn-unblock-${targetId}`}
              type="button"
              disabled={isBusy}
              onClick={() => handleUnblock(targetId)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 border border-stone-800 hover:border-stone-700 text-stone-300 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
            >
              <ShieldOff className="w-3.5 h-3.5" />
              <span>{isBusy ? 'Unblocking...' : 'Unblock'}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
