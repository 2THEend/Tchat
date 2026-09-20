import React, { useEffect, useState } from 'react';
import { 
  X, 
  Users, 
  ShieldCheck, 
  Shield, 
  Star, 
  User as UserIcon, 
  Loader2,
  Calendar
} from 'lucide-react';
import { TchatGroupMember, GroupRole } from '../../domains/groups/types';
import { listGroupMembers } from '../../domains/groups/groupsService';
import { formatGroupError } from '../../domains/groups/validation';

interface GroupMembersModalProps {
  groupId: string;
  groupName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function GroupMembersModal({
  groupId,
  groupName,
  isOpen,
  onClose,
}: GroupMembersModalProps) {
  const [members, setMembers] = useState<TchatGroupMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    listGroupMembers(groupId).then((res) => {
      if (!isMounted) return;
      if (res.error) {
        setError(formatGroupError(res.error));
      } else {
        setMembers(res.data || []);
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
  }, [groupId, isOpen]);

  if (!isOpen) return null;

  const renderRoleBadge = (role: GroupRole) => {
    switch (role) {
      case 'admin':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-[10px] font-medium text-emerald-300 font-mono">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span>Admin</span>
          </span>
        );
      case 'mod':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-950/80 border border-blue-700/60 text-[10px] font-medium text-blue-300 font-mono">
            <Shield className="w-3 h-3 text-blue-400" />
            <span>Mod</span>
          </span>
        );
      case 'special':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-700/60 text-[10px] font-medium text-amber-300 font-mono">
            <Star className="w-3 h-3 text-amber-400" />
            <span>Special</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-900 border border-stone-800 text-[10px] font-medium text-stone-400 font-mono">
            <span>Member</span>
          </span>
        );
    }
  };

  return (
    <div 
      id="group-members-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        id="group-members-modal-container"
        className="w-full max-w-md bg-stone-950 border border-stone-800/80 rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col overflow-hidden text-stone-100 shadow-2xl shadow-black animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-stone-900/80 flex items-center justify-between bg-stone-950/90 backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-300 shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-stone-100 truncate">
                {groupName}
              </h2>
              <p className="text-[11px] text-stone-400">
                {members.length} active {members.length === 1 ? 'member' : 'members'}
              </p>
            </div>
          </div>

          <button
            id="btn-close-members-modal"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
            aria-label="Close member list"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-stone-400">
              <Loader2 className="w-6 h-6 animate-spin text-stone-300" />
              <span className="text-xs">Loading active members...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-800/50 text-xs text-rose-300 space-y-1">
              <p className="font-semibold">Unable to load members</p>
              <p className="text-[11px] text-rose-400/90">{error}</p>
            </div>
          ) : members.length === 0 ? (
            <div className="py-12 text-center text-stone-500 text-xs">
              No active members found.
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((member) => {
                const joinedFormatted = member.joined_at
                  ? new Date(member.joined_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })
                  : null;

                return (
                  <div
                    key={member.user_id}
                    id={`member-row-${member.user_id}`}
                    className="p-3 rounded-2xl bg-stone-900/50 border border-stone-800/60 flex items-center justify-between gap-3 hover:bg-stone-900/80 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {member.avatar_url ? (
                        <img
                          src={member.avatar_url}
                          alt={member.display_name || member.username || 'Member'}
                          className="w-9 h-9 rounded-xl object-cover border border-stone-700/60 shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-400 shrink-0">
                          <UserIcon className="w-4 h-4" />
                        </div>
                      )}

                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-stone-200 truncate">
                          {member.display_name || member.username || 'Member'}
                        </p>
                        {member.username && (
                          <p className="text-[11px] text-stone-400 font-mono truncate">
                            @{member.username}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {renderRoleBadge(member.role)}
                      {joinedFormatted && (
                        <span className="text-[10px] text-stone-400 flex items-center gap-1">
                          <Calendar className="w-2.5 h-2.5" />
                          <span>Joined {joinedFormatted}</span>
                        </span>
                      )}
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
            id="btn-dismiss-members-modal"
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
