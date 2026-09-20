import React, { useEffect, useState } from 'react';
import { 
  X, 
  LogOut, 
  AlertTriangle, 
  ShieldAlert, 
  ShieldCheck, 
  Loader2, 
  Check, 
  User as UserIcon 
} from 'lucide-react';
import { GroupRole, TchatGroupMember } from '../../domains/groups/types';
import { listGroupMembers, leaveGroup } from '../../domains/groups/groupsService';
import { formatGroupError } from '../../domains/groups/validation';

interface GroupLeaveModalProps {
  groupId: string;
  groupName: string;
  userRole: GroupRole;
  memberCount: number;
  currentUserId: string;
  isOpen: boolean;
  onClose: () => void;
  onLeaveSuccess: () => void;
}

export function GroupLeaveModal({
  groupId,
  groupName,
  userRole,
  memberCount,
  currentUserId,
  isOpen,
  onClose,
  onLeaveSuccess,
}: GroupLeaveModalProps) {
  const [isLeaving, setIsLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Successor selection state for Admin when multiple active members exist
  const [potentialSuccessors, setPotentialSuccessors] = useState<TchatGroupMember[]>([]);
  const [selectedSuccessorId, setSelectedSuccessorId] = useState<string | null>(null);
  const [isLoadingSuccessors, setIsLoadingSuccessors] = useState(false);

  const isAdmin = userRole === 'admin';
  const hasMultipleMembers = memberCount > 1;

  useEffect(() => {
    if (!isOpen || !isAdmin || !hasMultipleMembers) return;

    let isMounted = true;
    setIsLoadingSuccessors(true);
    setError(null);

    listGroupMembers(groupId).then((res) => {
      if (!isMounted) return;
      if (res.error) {
        setError(formatGroupError(res.error));
      } else {
        const others = (res.data || []).filter((m) => m.user_id !== currentUserId);
        setPotentialSuccessors(others);
        if (others.length > 0) {
          setSelectedSuccessorId(others[0].user_id);
        }
      }
      setIsLoadingSuccessors(false);
    }).catch((err) => {
      if (!isMounted) return;
      setError(formatGroupError(err?.message));
      setIsLoadingSuccessors(false);
    });

    return () => {
      isMounted = false;
    };
  }, [groupId, isOpen, isAdmin, hasMultipleMembers, currentUserId]);

  if (!isOpen) return null;

  const handleConfirmLeave = async () => {
    setIsLeaving(true);
    setError(null);

    let successorId: string | undefined = undefined;
    if (isAdmin && hasMultipleMembers) {
      if (!selectedSuccessorId) {
        setError('Please choose an active member to succeed as administrator.');
        setIsLeaving(false);
        return;
      }
      successorId = selectedSuccessorId;
    }

    const res = await leaveGroup(groupId, successorId);
    if (res.error) {
      setError(formatGroupError(res.error));
      setIsLeaving(false);
    } else {
      setIsLeaving(false);
      onLeaveSuccess();
    }
  };

  return (
    <div 
      id="group-leave-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        id="group-leave-modal-container"
        className="w-full max-w-md bg-stone-950 border border-stone-800/80 rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col overflow-hidden text-stone-100 shadow-2xl shadow-black animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-stone-900/80 flex items-center justify-between bg-stone-950/90 backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-rose-950/60 border border-rose-800/60 flex items-center justify-center text-rose-400 shrink-0">
              <LogOut className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-stone-100 truncate">
                Leave Group
              </h2>
              <p className="text-[11px] text-stone-400 truncate">
                {groupName}
              </p>
            </div>
          </div>

          <button
            id="btn-close-leave-modal"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
            aria-label="Cancel leaving"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800/60 text-xs text-rose-300">
              {error}
            </div>
          )}

          {/* Case 1: Admin with other active members */}
          {isAdmin && hasMultipleMembers ? (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-800/40 text-xs text-amber-200/90 space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-amber-300">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>Admin Succession Required</span>
                </div>
                <p className="text-[11px] text-amber-200/80 leading-relaxed">
                  Every group must maintain an active administrator. Choose a member to take over administration before you depart.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-stone-300 uppercase tracking-wider font-mono">
                  Select New Admin
                </label>

                {isLoadingSuccessors ? (
                  <div className="py-6 flex items-center justify-center gap-2 text-stone-400 text-xs">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading members...</span>
                  </div>
                ) : potentialSuccessors.length === 0 ? (
                  <p className="text-xs text-stone-400">No other active members found.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {potentialSuccessors.map((member) => {
                      const isSelected = selectedSuccessorId === member.user_id;

                      return (
                        <div
                          key={member.user_id}
                          id={`successor-option-${member.user_id}`}
                          onClick={() => setSelectedSuccessorId(member.user_id)}
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-emerald-950/30 border-emerald-700/80 text-emerald-100'
                              : 'bg-stone-900/40 border-stone-800/60 text-stone-300 hover:bg-stone-900/80'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {member.avatar_url ? (
                              <img
                                src={member.avatar_url}
                                alt={member.display_name || member.username || 'Member'}
                                className="w-8 h-8 rounded-lg object-cover shrink-0"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-lg bg-stone-800 flex items-center justify-center text-stone-400 shrink-0">
                                <UserIcon className="w-4 h-4" />
                              </div>
                            )}

                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate">
                                {member.display_name || member.username || 'Member'}
                              </p>
                              {member.username && (
                                <p className="text-[10px] text-stone-400 font-mono truncate">
                                  @{member.username}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="w-5 h-5 rounded-full border border-stone-700 flex items-center justify-center shrink-0">
                            {isSelected && (
                              <div className="w-3 h-3 rounded-full bg-emerald-400" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : isAdmin && !hasMultipleMembers ? (
            /* Case 2: Admin is the sole member */
            <div className="space-y-3">
              <div className="p-4 rounded-2xl bg-rose-950/25 border border-rose-900/40 text-xs text-rose-200/90 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-rose-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Group Dissolution</span>
                </div>
                <p className="text-[11px] text-rose-200/80 leading-relaxed">
                  You are currently the only member of <span className="font-semibold text-stone-100">{groupName}</span>.
                </p>
                <p className="text-[11px] text-rose-200/80 leading-relaxed">
                  Leaving will permanently dissolve and delete this temporary space according to Tchat lifecycle rules.
                </p>
              </div>
            </div>
          ) : (
            /* Case 3: Regular member / Mod leaving */
            <div className="space-y-3">
              <p className="text-xs text-stone-300 leading-relaxed">
                Are you sure you want to leave <span className="font-semibold text-stone-100">{groupName}</span>?
              </p>
              <p className="text-[11px] text-stone-400 leading-relaxed">
                You will no longer participate in this temporary group. You can rejoin or request to join again later subject to group access rules.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="p-4 border-t border-stone-900/80 bg-stone-950/80 space-y-2">
          <button
            id="btn-confirm-leave-group"
            type="button"
            disabled={isLeaving || (isAdmin && hasMultipleMembers && !selectedSuccessorId)}
            onClick={handleConfirmLeave}
            className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold tracking-tight transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm shadow-rose-950"
          >
            {isLeaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogOut className="w-4 h-4" />
            )}
            <span>
              {isAdmin && hasMultipleMembers
                ? 'Transfer Admin & Leave'
                : isAdmin && !hasMultipleMembers
                ? 'Dissolve & Leave Group'
                : 'Leave Group'}
            </span>
          </button>

          <button
            id="btn-cancel-leave-group"
            type="button"
            disabled={isLeaving}
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-stone-100 text-xs font-medium transition-colors cursor-pointer text-center"
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
