import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Users, 
  Clock, 
  ShieldCheck, 
  Shield, 
  Star, 
  User as UserIcon, 
  LogOut, 
  Inbox, 
  MessageSquare, 
  Info,
  Sparkles,
  Lock,
  Globe
} from 'lucide-react';
import { GroupDetails, GroupRole } from '../../domains/groups/types';
import { GroupMembersModal } from './GroupMembersModal';
import { GroupJoinRequestsModal } from './GroupJoinRequestsModal';
import { GroupLeaveModal } from './GroupLeaveModal';
import { getGroupJoinRequests } from '../../domains/groups/groupsService';

interface ActiveGroupViewProps {
  group: GroupDetails;
  currentUserId: string;
  onBackToHome: () => void;
  onViewDetails: () => void;
  onLeaveSuccess: () => void;
  onRefreshGroup: () => void;
}

export function ActiveGroupView({
  group,
  currentUserId,
  onBackToHome,
  onViewDetails,
  onLeaveSuccess,
  onRefreshGroup,
}: ActiveGroupViewProps) {
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [isRequestsModalOpen, setIsRequestsModalOpen] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);

  const userRole: GroupRole = group.membership?.role || 'member';
  const isAdminOrMod = userRole === 'admin' || userRole === 'mod';

  // Check pending requests count for admin/mod
  useEffect(() => {
    if (!isAdminOrMod) return;

    let isMounted = true;
    getGroupJoinRequests(group.id).then((res) => {
      if (isMounted && res.data) {
        setPendingRequestsCount(res.data.length);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [group.id, isAdminOrMod]);

  // Expiration formatting
  const expiresFormatted = new Date(group.expires_at).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const lifetimeLabel = group.lifetime === '1_day' 
    ? '1 Day' 
    : group.lifetime === '3_days' 
    ? '3 Days' 
    : '1 Week';

  const renderRoleBadge = (role: GroupRole) => {
    switch (role) {
      case 'admin':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-xs font-semibold text-emerald-300 font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Admin</span>
          </span>
        );
      case 'mod':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-950/80 border border-blue-700/60 text-xs font-semibold text-blue-300 font-mono">
            <Shield className="w-3.5 h-3.5 text-blue-400" />
            <span>Mod</span>
          </span>
        );
      case 'special':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-950/80 border border-amber-700/60 text-xs font-semibold text-amber-300 font-mono">
            <Star className="w-3.5 h-3.5 text-amber-400" />
            <span>Special</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-900 border border-stone-800 text-xs font-medium text-stone-300 font-mono">
            <UserIcon className="w-3.5 h-3.5 text-stone-400" />
            <span>Member</span>
          </span>
        );
    }
  };

  return (
    <div 
      id="active-group-view" 
      className="flex-1 overflow-y-auto flex flex-col bg-stone-950 text-stone-100 selection:bg-stone-800"
    >
      {/* Top Header */}
      <header className="sticky top-0 z-20 bg-stone-950/90 backdrop-blur-md px-5 py-3.5 border-b border-stone-900/60 flex items-center justify-between">
        <button
          id="btn-back-to-home-from-group"
          type="button"
          onClick={onBackToHome}
          className="flex items-center gap-2 p-1.5 -ml-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer text-xs"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Home</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            id="btn-open-group-members-header"
            type="button"
            onClick={() => setIsMembersModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 text-xs font-medium transition-colors cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 text-stone-400" />
            <span>{group.member_count}</span>
          </button>

          <button
            id="btn-open-group-details-header"
            type="button"
            onClick={onViewDetails}
            className="p-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
            title="Group Information"
            aria-label="Group Information"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="px-5 py-6 space-y-6 flex-1">
        {/* Cover Preview / Banner */}
        <div className="relative w-full h-36 rounded-3xl bg-stone-900/80 border border-stone-800/80 overflow-hidden flex items-center justify-center">
          {group.cover_url ? (
            <img 
              src={group.cover_url} 
              alt={group.name} 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-stone-800/80 border border-stone-700/60 flex items-center justify-center text-stone-400">
              <Users className="w-7 h-7 stroke-[1.5]" />
            </div>
          )}

          {/* Visibility & Lifetime Overlay */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-950/80 backdrop-blur-md border border-stone-700/50 text-[10px] font-mono text-stone-300">
              {group.visibility === 'private' ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
              <span className="capitalize">{group.visibility}</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-950/80 backdrop-blur-md border border-stone-700/50 text-[10px] font-mono text-stone-300">
              <Clock className="w-3 h-3 text-amber-400" />
              <span>{lifetimeLabel}</span>
            </span>
          </div>
        </div>

        {/* Group Identity */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-stone-100 truncate">
              {group.name}
            </h1>
            {renderRoleBadge(userRole)}
          </div>
          <p className="text-xs text-stone-300 leading-relaxed bg-stone-900/50 p-3.5 rounded-2xl border border-stone-800/70">
            {group.reason}
          </p>
        </div>

        {/* Admin/Mod Review Notification */}
        {isAdminOrMod && pendingRequestsCount > 0 && (
          <div
            id="active-group-pending-requests-banner"
            onClick={() => setIsRequestsModalOpen(true)}
            className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-800/50 flex items-center justify-between gap-3 cursor-pointer hover:bg-amber-950/40 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-amber-900/60 border border-amber-700/60 flex items-center justify-center text-amber-300 shrink-0">
                <Inbox className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-amber-200">
                  {pendingRequestsCount} Join {pendingRequestsCount === 1 ? 'Request' : 'Requests'}
                </p>
                <p className="text-[11px] text-amber-300/70">
                  Review applicant answers and admit members
                </p>
              </div>
            </div>

            <span className="px-2.5 py-1 rounded-xl bg-amber-900/70 text-amber-200 text-xs font-medium font-mono shrink-0">
              Review
            </span>
          </div>
        )}

        {/* Phase 6.3 Destination Notice */}
        <div className="p-5 rounded-3xl bg-stone-900/40 border border-stone-800/70 space-y-4">
          <div className="flex items-center gap-2.5 text-stone-200">
            <div className="w-9 h-9 rounded-2xl bg-stone-800/90 border border-stone-700/60 flex items-center justify-center text-amber-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-semibold text-stone-100">
                Temporary Group Active Space
              </h2>
              <p className="text-[11px] text-stone-400">
                Membership verified • Destination ready for Phase 6.3
              </p>
            </div>
          </div>

          <p className="text-xs text-stone-300 leading-relaxed">
            You are an active member of this intentional group. The group exists for <span className="text-amber-300 font-mono font-medium">{lifetimeLabel}</span> and will expire on <span className="text-stone-100 font-medium">{expiresFormatted}</span>.
          </p>

          <div className="pt-2 border-t border-stone-800/60 grid grid-cols-2 gap-2 text-xs">
            <button
              id="btn-view-members-space"
              type="button"
              onClick={() => setIsMembersModalOpen(true)}
              className="py-2.5 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-200 text-xs font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 border border-stone-800"
            >
              <Users className="w-3.5 h-3.5 text-stone-400" />
              <span>Members ({group.member_count})</span>
            </button>

            <button
              id="btn-view-details-space"
              type="button"
              onClick={onViewDetails}
              className="py-2.5 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-200 text-xs font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 border border-stone-800"
            >
              <Info className="w-3.5 h-3.5 text-stone-400" />
              <span>Group Details</span>
            </button>
          </div>
        </div>

        {/* Leave Group Action */}
        <div className="pt-4 border-t border-stone-900/60">
          <button
            id="btn-open-leave-modal-space"
            type="button"
            onClick={() => setIsLeaveModalOpen(true)}
            className="w-full py-3 rounded-xl bg-stone-900/60 hover:bg-rose-950/40 text-stone-400 hover:text-rose-300 border border-stone-800/60 hover:border-rose-900/40 text-xs font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Leave Group</span>
          </button>
        </div>
      </div>

      {/* Modals */}
      <GroupMembersModal
        groupId={group.id}
        groupName={group.name}
        isOpen={isMembersModalOpen}
        onClose={() => setIsMembersModalOpen(false)}
      />

      <GroupJoinRequestsModal
        groupId={group.id}
        groupName={group.name}
        isOpen={isRequestsModalOpen}
        onClose={() => setIsRequestsModalOpen(false)}
        onRequestProcessed={() => {
          onRefreshGroup();
          getGroupJoinRequests(group.id).then((res) => {
            if (res.data) setPendingRequestsCount(res.data.length);
          });
        }}
      />

      <GroupLeaveModal
        groupId={group.id}
        groupName={group.name}
        userRole={userRole}
        memberCount={group.member_count}
        currentUserId={currentUserId}
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        onLeaveSuccess={onLeaveSuccess}
      />
    </div>
  );
}
