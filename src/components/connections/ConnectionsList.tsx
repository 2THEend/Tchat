import { useState } from 'react';
import { User, UserMinus, ShieldAlert, AlertCircle, Calendar, MessageSquare } from 'lucide-react';
import { TchatConnection } from '../../domains/connections/types';

interface ConnectionsListProps {
  connections: TchatConnection[];
  onUnfriend: (targetUserId: string) => Promise<void>;
  onBlock: (targetUserId: string) => Promise<void>;
  isLoading: boolean;
  onOpenConversation?: (targetUserId: string, partnerProfile?: any) => void;
}

export function ConnectionsList({
  connections,
  onUnfriend,
  onBlock,
  isLoading,
  onOpenConversation,
}: ConnectionsListProps) {
  const [confirmUnfriendId, setConfirmUnfriendId] = useState<string | null>(null);
  const [confirmBlockId, setConfirmBlockId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUnfriendConfirm = async (userId: string) => {
    setProcessingId(userId);
    setError(null);
    try {
      await onUnfriend(userId);
      setConfirmUnfriendId(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to unfriend.';
      setError(msg);
    } finally {
      setProcessingId(null);
    }
  };

  const handleBlockConfirm = async (userId: string) => {
    setProcessingId(userId);
    setError(null);
    try {
      await onBlock(userId);
      setConfirmBlockId(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to block user.';
      setError(msg);
    } finally {
      setProcessingId(null);
    }
  };

  if (connections.length === 0 && !isLoading) {
    return (
      <div id="connections-empty" className="p-8 text-center rounded-2xl bg-stone-900/30 border border-stone-800/40 space-y-1">
        <p className="text-xs font-medium text-stone-300">No connections yet</p>
        <p className="text-[11px] text-stone-400 max-w-xs mx-auto">
          Tchat connections are intentional 1:1 human relationships. Use "Find People" to search and send a connection request with context.
        </p>
      </div>
    );
  }

  return (
    <div id="connections-list" className="space-y-3">
      {error && (
        <div className="flex items-center gap-1.5 p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {connections.map((conn) => {
        const other = conn.other_user;
        const otherId = other?.id || (conn.user_a_id);
        const isBusy = processingId === otherId;
        const connectedDate = new Date(conn.created_at).toLocaleDateString(undefined, {
          month: 'short',
          year: 'numeric',
        });

        return (
          <div
            key={conn.id}
            id={`connection-card-${conn.id}`}
            className="p-4 rounded-2xl bg-stone-900/70 border border-stone-800/80 space-y-3"
          >
            {/* User Profile Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
                  {other?.avatar_url ? (
                    <img 
                      src={other.avatar_url} 
                      alt={other.display_name || other.username} 
                      className="w-full h-full object-cover" 
                    />
                  ) : (
                    <User className="w-5 h-5 text-stone-400" />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="text-xs font-semibold text-stone-100 truncate">
                    {other?.display_name || other?.username || 'Tchat Member'}
                  </div>
                  <div className="text-[11px] font-mono text-stone-400">
                    @{other?.username || 'member'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 text-[10px] text-stone-400 font-mono shrink-0">
                <Calendar className="w-3 h-3 text-stone-400" />
                <span>Connected {connectedDate}</span>
              </div>
            </div>

            {other?.bio && (
              <p className="text-[11px] text-stone-300 leading-relaxed pt-1 border-t border-stone-800/40">
                {other.bio}
              </p>
            )}

            {/* Unfriend Confirm Dialog */}
            {confirmUnfriendId === otherId ? (
              <div className="p-3 rounded-xl bg-stone-950 border border-stone-800 space-y-2">
                <p className="text-xs text-stone-200">
                  Remove connection with <span className="font-semibold text-stone-100">@{other?.username}</span>?
                </p>
                <p className="text-[10px] text-stone-400">
                  This terminates the connection. They will not be blocked and can be reconnected with in the future.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setConfirmUnfriendId(null)}
                    className="flex-1 py-1.5 rounded-lg bg-stone-800 text-stone-300 text-xs font-medium hover:bg-stone-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    id={`btn-confirm-unfriend-${otherId}`}
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleUnfriendConfirm(otherId)}
                    className="flex-1 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    {isBusy ? 'Removing...' : 'Confirm Remove'}
                  </button>
                </div>
              </div>
            ) : confirmBlockId === otherId ? (
              /* Block Confirm Dialog */
              <div className="p-3 rounded-xl bg-stone-950 border border-rose-900/60 space-y-2">
                <p className="text-xs text-rose-300 font-medium">
                  Block <span className="font-semibold text-rose-200">@{other?.username}</span>?
                </p>
                <p className="text-[10px] text-stone-400">
                  This removes the connection immediately and prevents them from finding you, viewing your profile, or sending requests.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setConfirmBlockId(null)}
                    className="flex-1 py-1.5 rounded-lg bg-stone-800 text-stone-300 text-xs font-medium hover:bg-stone-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    id={`btn-confirm-block-${otherId}`}
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleBlockConfirm(otherId)}
                    className="flex-1 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    {isBusy ? 'Blocking...' : 'Confirm Block'}
                  </button>
                </div>
              </div>
            ) : (
              /* Standard Actions: Message, Unfriend & Block */
              <div className="flex items-center justify-end gap-2 pt-1">
                {onOpenConversation && (
                  <button
                    id={`btn-message-${otherId}`}
                    type="button"
                    disabled={isBusy}
                    onClick={() => onOpenConversation(otherId, other)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold transition-colors cursor-pointer shadow-xs mr-auto"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Message</span>
                  </button>
                )}

                <button
                  id={`btn-unfriend-${otherId}`}
                  type="button"
                  disabled={isBusy}
                  onClick={() => setConfirmUnfriendId(otherId)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 border border-stone-800 hover:border-stone-700 text-stone-400 hover:text-stone-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  <UserMinus className="w-3.5 h-3.5" />
                  <span>Unfriend</span>
                </button>

                <button
                  id={`btn-block-${otherId}`}
                  type="button"
                  disabled={isBusy}
                  onClick={() => setConfirmBlockId(otherId)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 border border-stone-800 hover:border-rose-900/60 hover:text-rose-400 hover:bg-rose-950/20 text-stone-400 text-xs font-medium transition-colors cursor-pointer"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Block</span>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
