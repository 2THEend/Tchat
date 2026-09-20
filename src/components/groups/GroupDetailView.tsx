import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Users, 
  Clock, 
  Lock, 
  Globe, 
  HelpCircle, 
  ShieldCheck, 
  Shield,
  Star,
  User as UserIcon,
  CheckCircle2, 
  LogOut,
  Inbox,
  AlertCircle,
  Loader2,
  Send,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { 
  GroupDetails, 
  GroupRole, 
  TchatGroupJoinRequest 
} from '../../domains/groups/types';
import { 
  getGroupDetails,
  joinGroup, 
  requestToJoinGroup, 
  cancelGroupJoinRequest,
  getMyPendingJoinRequest,
  checkGroupBanStatus,
  getGroupJoinRequests
} from '../../domains/groups/groupsService';
import { formatGroupError, validateJoinQuestionAnswer } from '../../domains/groups/validation';
import { GroupMembersModal } from './GroupMembersModal';
import { GroupJoinRequestsModal } from './GroupJoinRequestsModal';
import { GroupLeaveModal } from './GroupLeaveModal';

interface GroupDetailViewProps {
  groupId: string;
  currentUserId: string;
  initialGroup?: GroupDetails | null;
  onBack: () => void;
  onEnterGroup: (group: GroupDetails) => void;
  onLeaveSuccess: () => void;
}

export function GroupDetailView({
  groupId,
  currentUserId,
  initialGroup = null,
  onBack,
  onEnterGroup,
  onLeaveSuccess,
}: GroupDetailViewProps) {
  const [group, setGroup] = useState<GroupDetails | null>(initialGroup);
  const [isLoading, setIsLoading] = useState(!initialGroup);
  const [error, setError] = useState<string | null>(null);

  // Membership & auxiliary state
  const [pendingRequest, setPendingRequest] = useState<TchatGroupJoinRequest | null>(null);
  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState<string | null>(null);
  const [adminRequestsCount, setAdminRequestsCount] = useState(0);

  // Question answer form state
  const [questionAnswer, setQuestionAnswer] = useState('');
  const [answerError, setAnswerError] = useState<string | null>(null);

  // Modal open states
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [isRequestsModalOpen, setIsRequestsModalOpen] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);

  // Action busy states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Load group details and auxiliary states
  const loadGroupData = async () => {
    setError(null);
    setActionError(null);

    try {
      const detailsRes = await getGroupDetails(groupId);
      if (detailsRes.error) {
        // Check if user was banned
        const banCheck = await checkGroupBanStatus(groupId);
        if (banCheck.data?.isBanned) {
          setIsBanned(true);
          setBanReason(banCheck.data.reason || null);
          setIsLoading(false);
          return;
        }

        setError(formatGroupError(detailsRes.error));
        setIsLoading(false);
        return;
      }

      if (detailsRes.data) {
        setGroup(detailsRes.data);

        // Check pending join request if user is not an active member
        if (!detailsRes.data.membership || detailsRes.data.membership.status !== 'active') {
          const reqRes = await getMyPendingJoinRequest(groupId);
          if (reqRes.data) {
            setPendingRequest(reqRes.data);
          } else {
            setPendingRequest(null);
          }
        } else {
          setPendingRequest(null);
        }

        // If user is Admin or Mod, check join requests count
        const role = detailsRes.data.membership?.role;
        if (role === 'admin' || role === 'mod') {
          const requestsRes = await getGroupJoinRequests(groupId);
          if (requestsRes.data) {
            setAdminRequestsCount(requestsRes.data.length);
          }
        }
      }
    } catch (err: any) {
      setError(formatGroupError(err?.message));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadGroupData();
  }, [groupId]);

  // Direct Join (Open mode)
  const handleDirectJoin = async () => {
    setIsSubmitting(true);
    setActionError(null);

    const res = await joinGroup(groupId);
    if (res.error) {
      setActionError(formatGroupError(res.error));
      setIsSubmitting(false);
    } else {
      await loadGroupData();
      setIsSubmitting(false);
    }
  };

  // Submit Request (Request mode or dynamic surge mode)
  const handleRequestToJoin = async () => {
    setIsSubmitting(true);
    setActionError(null);

    const res = await requestToJoinGroup(groupId);
    if (res.error) {
      setActionError(formatGroupError(res.error));
      setIsSubmitting(false);
    } else {
      await loadGroupData();
      setIsSubmitting(false);
    }
  };

  // Submit Question Answer
  const handleQuestionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = validateJoinQuestionAnswer(questionAnswer);
    if (!val.isValid) {
      setAnswerError(val.error || 'Please enter a valid answer (2-500 characters).');
      return;
    }

    setAnswerError(null);
    setIsSubmitting(true);
    setActionError(null);

    const res = await requestToJoinGroup(groupId, questionAnswer.trim());
    if (res.error) {
      setActionError(formatGroupError(res.error));
      setIsSubmitting(false);
    } else {
      setQuestionAnswer('');
      await loadGroupData();
      setIsSubmitting(false);
    }
  };

  // Cancel Request
  const handleCancelRequest = async () => {
    if (!pendingRequest) return;
    setIsSubmitting(true);
    setActionError(null);

    const res = await cancelGroupJoinRequest(pendingRequest.id, groupId);
    if (res.error) {
      setActionError(formatGroupError(res.error));
      setIsSubmitting(false);
    } else {
      setPendingRequest(null);
      await loadGroupData();
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div id="group-detail-loading" className="flex-1 flex flex-col items-center justify-center p-6 bg-stone-950 text-stone-300">
        <Loader2 className="w-8 h-8 animate-spin text-stone-400 mb-3" />
        <span className="text-xs">Loading group details...</span>
      </div>
    );
  }

  // Banned State
  if (isBanned) {
    return (
      <div id="group-banned-view" className="flex-1 flex flex-col bg-stone-950 text-stone-100">
        <header className="px-5 py-3.5 border-b border-stone-900/60 flex items-center">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 p-1.5 -ml-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer text-xs"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-950/50 border border-rose-800/50 flex items-center justify-center text-rose-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h1 className="text-base font-semibold text-stone-100">
            Access Restricted
          </h1>
          <p className="text-xs text-stone-400 max-w-xs leading-relaxed">
            You are restricted from participating in this group.
          </p>
          {banReason && (
            <p className="text-[11px] text-rose-400/80 italic">
              "{banReason}"
            </p>
          )}
          <button
            type="button"
            onClick={onBack}
            className="mt-4 px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 text-xs font-medium transition-colors cursor-pointer"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  // Unavailable / Error State
  if (error || !group) {
    return (
      <div id="group-unavailable-view" className="flex-1 flex flex-col bg-stone-950 text-stone-100">
        <header className="px-5 py-3.5 border-b border-stone-900/60 flex items-center">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 p-1.5 -ml-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer text-xs"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-400">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-base font-semibold text-stone-100">
            Group Unavailable
          </h1>
          <p className="text-xs text-stone-400 max-w-xs leading-relaxed">
            {error || 'This group could not be found or is private and inaccessible.'}
          </p>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={loadGroupData}
              className="px-3.5 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
            <button
              type="button"
              onClick={onBack}
              className="px-3.5 py-2 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold tracking-tight transition-colors cursor-pointer"
            >
              Return Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active group membership checks
  const isMember = group.membership?.status === 'active';
  const isRemoved = group.membership?.status === 'removed';
  const isLeft = group.membership?.status === 'left';
  const userRole: GroupRole = group.membership?.role || 'member';
  const isAdminOrMod = userRole === 'admin' || userRole === 'mod';
  const isFull = group.member_count >= group.max_size;
  const isExpired = new Date(group.expires_at).getTime() <= Date.now() || group.lifecycle_status !== 'active';

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

  const effectiveMode = group.effective_access_mode || group.access_mode;
  const isSurged = group.access_mode === 'open' && effectiveMode === 'request';

  return (
    <div 
      id="group-detail-view" 
      className="flex-1 overflow-y-auto flex flex-col bg-stone-950 text-stone-100 selection:bg-stone-800"
    >
      {/* Top Header */}
      <header className="sticky top-0 z-20 bg-stone-950/90 backdrop-blur-md px-5 py-3.5 border-b border-stone-900/60 flex items-center justify-between">
        <button
          id="btn-back-from-group-detail"
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 p-1.5 -ml-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer text-xs"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Home</span>
        </button>

        <div className="flex items-center gap-2">
          {isMember && (
            <button
              id="btn-open-members-from-detail"
              type="button"
              onClick={() => setIsMembersModalOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 text-xs font-medium transition-colors cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 text-stone-400" />
              <span>{group.member_count}</span>
            </button>
          )}

          <span className="text-[10px] font-semibold tracking-wider uppercase text-amber-400 font-mono">
            {lifetimeLabel}
          </span>
        </div>
      </header>

      {/* Action Error Banner */}
      {actionError && (
        <div className="mx-5 mt-4 p-3.5 rounded-2xl bg-rose-950/60 border border-rose-800/70 text-xs text-rose-200 flex items-center justify-between gap-2">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-400 hover:text-rose-100 text-[10px] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="px-5 py-6 space-y-6 flex-1">
        {/* Cover Preview / Banner */}
        <div className="relative w-full h-40 rounded-3xl bg-stone-900/80 border border-stone-800/80 overflow-hidden flex items-center justify-center">
          {group.cover_url ? (
            <img 
              src={group.cover_url} 
              alt={group.name} 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-stone-800/80 border border-stone-700/60 flex items-center justify-center text-stone-400">
              <Users className="w-8 h-8 stroke-[1.5]" />
            </div>
          )}

          {/* Badges */}
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

        {/* Identity & Purpose */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-stone-100">
              {group.name}
            </h1>
            {isMember && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-[11px] font-semibold text-emerald-300 font-mono">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="capitalize">{userRole}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-stone-300 leading-relaxed bg-stone-900/50 p-3.5 rounded-2xl border border-stone-800/70">
            {group.reason}
          </p>
        </div>

        {/* Configuration & State Grid */}
        <div className="p-4 rounded-2xl bg-stone-900/40 border border-stone-800/70 space-y-3">
          <h2 className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider font-mono">
            Group Details
          </h2>

          <div className="grid grid-cols-2 gap-3 text-xs">
            {/* Administrator */}
            <div className="p-3 rounded-xl bg-stone-900/60 border border-stone-800/60 space-y-1">
              <span className="text-[10px] text-stone-400 uppercase tracking-wide">Administrator</span>
              <p className="font-semibold text-stone-200 truncate">
                {group.admin?.display_name || group.admin?.username || 'Admin'}
              </p>
            </div>

            {/* Capacity */}
            <div className="p-3 rounded-xl bg-stone-900/60 border border-stone-800/60 space-y-1">
              <span className="text-[10px] text-stone-400 uppercase tracking-wide">Capacity</span>
              <p className="font-semibold text-stone-200">
                {group.member_count} of {group.max_size} members
              </p>
            </div>

            {/* Joining Method */}
            <div className="p-3 rounded-xl bg-stone-900/60 border border-stone-800/60 space-y-1">
              <span className="text-[10px] text-stone-400 uppercase tracking-wide">Joining Method</span>
              <p className="font-semibold text-stone-200 capitalize">
                {isSurged ? 'Request (Surge)' : group.access_mode}
              </p>
            </div>

            {/* Expiration */}
            <div className="p-3 rounded-xl bg-stone-900/60 border border-stone-800/60 space-y-1">
              <span className="text-[10px] text-stone-400 uppercase tracking-wide">Expires</span>
              <p className="font-semibold text-amber-300/90 text-[11px] truncate">
                {expiresFormatted}
              </p>
            </div>
          </div>

          {/* Capacity Surge Note */}
          {isSurged && !isMember && (
            <div className="pt-2 border-t border-stone-800/60 text-[11px] text-amber-300/90 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Capacity surge protection: Group has reached 50% capacity, so new joins require admin/mod request review.
              </span>
            </div>
          )}
        </div>

        {/* Admin/Mod Review Notification Bar */}
        {isAdminOrMod && adminRequestsCount > 0 && (
          <div
            id="btn-open-join-requests-banner"
            onClick={() => setIsRequestsModalOpen(true)}
            className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-800/50 flex items-center justify-between gap-3 cursor-pointer hover:bg-amber-950/40 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-amber-900/60 border border-amber-700/60 flex items-center justify-center text-amber-300 shrink-0">
                <Inbox className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-amber-200">
                  {adminRequestsCount} Join {adminRequestsCount === 1 ? 'Request' : 'Requests'}
                </p>
                <p className="text-[11px] text-amber-300/70">
                  Review applicant answers and approve members
                </p>
              </div>
            </div>

            <span className="px-2.5 py-1 rounded-xl bg-amber-900/70 text-amber-200 text-xs font-medium font-mono shrink-0">
              Review
            </span>
          </div>
        )}

        {/* Membership Actions Area */}
        <div className="space-y-4 pt-2 pb-8">
          {/* STATE 1: ACTIVE MEMBER */}
          {isMember ? (
            <div className="space-y-3">
              <button
                id="btn-enter-group-space"
                type="button"
                onClick={() => onEnterGroup(group)}
                className="w-full py-3.5 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-bold tracking-tight transition-colors cursor-pointer text-center flex items-center justify-center gap-2 shadow-sm"
              >
                <span>Enter Group</span>
              </button>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  id="btn-open-members-modal"
                  type="button"
                  onClick={() => setIsMembersModalOpen(true)}
                  className="py-2.5 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-200 text-xs font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 border border-stone-800"
                >
                  <Users className="w-3.5 h-3.5 text-stone-400" />
                  <span>Members ({group.member_count})</span>
                </button>

                <button
                  id="btn-open-leave-modal"
                  type="button"
                  onClick={() => setIsLeaveModalOpen(true)}
                  className="py-2.5 px-3 rounded-xl bg-stone-900/60 hover:bg-rose-950/40 text-stone-400 hover:text-rose-300 border border-stone-800/60 hover:border-rose-900/40 text-xs font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Leave Group</span>
                </button>
              </div>
            </div>
          ) : pendingRequest ? (
            /* STATE 2: PENDING JOIN REQUEST */
            <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-800/40 space-y-3">
              <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs">
                <Clock className="w-4 h-4 text-amber-400" />
                <span>Join Request Pending</span>
              </div>
              <p className="text-[11px] text-stone-300 leading-relaxed">
                Your request to join this group is currently being reviewed by the group administrator.
              </p>

              {pendingRequest.question_answer && (
                <div className="p-3 rounded-xl bg-stone-900/60 border border-stone-800 text-xs space-y-1">
                  <span className="text-[10px] text-amber-400 font-mono uppercase">Your Submitted Answer:</span>
                  <p className="text-stone-200 italic">"{pendingRequest.question_answer}"</p>
                </div>
              )}

              <button
                id="btn-cancel-join-request"
                type="button"
                disabled={isSubmitting}
                onClick={handleCancelRequest}
                className="w-full py-2.5 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-rose-300 text-xs font-medium transition-colors cursor-pointer border border-stone-800 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Cancel Join Request</span>
              </button>
            </div>
          ) : isRemoved ? (
            /* STATE 3: REMOVED USER */
            <div className="p-4 rounded-2xl bg-stone-900/40 border border-stone-800 text-xs text-stone-400 space-y-1 text-center">
              <p className="font-semibold text-stone-300">You were removed from this group</p>
              <p className="text-[11px]">
                Under Tchat rules, members removed from an intentional temporary group cannot rejoin.
              </p>
            </div>
          ) : isExpired ? (
            /* STATE 4: EXPIRED GROUP */
            <div className="p-4 rounded-2xl bg-stone-900/40 border border-stone-800 text-xs text-stone-400 space-y-1 text-center">
              <p className="font-semibold text-stone-300">This group has expired</p>
              <p className="text-[11px]">Temporary groups dissolve when their configured lifetime ends.</p>
            </div>
          ) : isFull ? (
            /* STATE 5: GROUP CAPACITY REACHED */
            <div className="p-4 rounded-2xl bg-stone-900/40 border border-stone-800 text-xs text-stone-400 space-y-1 text-center">
              <p className="font-semibold text-stone-300">Group at Maximum Capacity</p>
              <p className="text-[11px]">This group has reached its maximum size of {group.max_size} members.</p>
            </div>
          ) : effectiveMode === 'open' ? (
            /* STATE 6A: OPEN ACCESS DIRECT JOIN */
            <div className="space-y-2">
              <button
                id="btn-join-group-direct"
                type="button"
                disabled={isSubmitting}
                onClick={handleDirectJoin}
                className="w-full py-3.5 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-bold tracking-tight transition-colors cursor-pointer text-center flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>Join Group</span>
              </button>
              <p className="text-[11px] text-stone-400 text-center">
                This group allows direct entry.
              </p>
            </div>
          ) : effectiveMode === 'request' ? (
            /* STATE 6B: REQUEST ACCESS MODE */
            <div className="space-y-2">
              <button
                id="btn-request-to-join"
                type="button"
                disabled={isSubmitting}
                onClick={handleRequestToJoin}
                className="w-full py-3.5 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-bold tracking-tight transition-colors cursor-pointer text-center flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>Request to Join</span>
              </button>
              <p className="text-[11px] text-stone-400 text-center">
                The group administrator will review your request.
              </p>
            </div>
          ) : (
            /* STATE 6C: QUESTION ACCESS MODE */
            <form onSubmit={handleQuestionSubmit} className="space-y-3">
              <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-800/40 space-y-2">
                <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs">
                  <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Joining Question</span>
                </div>
                <p className="text-xs text-amber-100 italic">
                  "{group.joining_question || 'Why do you want to join this group?'}"
                </p>
              </div>

              <div className="space-y-1.5">
                <label 
                  htmlFor="input-join-question-answer" 
                  className="text-[11px] font-semibold text-stone-300 uppercase tracking-wider font-mono flex items-center justify-between"
                >
                  <span>Your Answer</span>
                  <span className="text-[10px] text-stone-400">
                    {questionAnswer.length} / 500
                  </span>
                </label>
                <textarea
                  id="input-join-question-answer"
                  value={questionAnswer}
                  onChange={(e) => setQuestionAnswer(e.target.value)}
                  placeholder="Type your response to the joining question..."
                  rows={3}
                  maxLength={500}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900 border border-stone-800 text-stone-100 placeholder:text-stone-400 text-xs focus:outline-none focus:border-stone-600 resize-none transition-colors"
                />
                {answerError && (
                  <p className="text-[11px] text-rose-400">{answerError}</p>
                )}
              </div>

              <button
                id="btn-submit-question-answer"
                type="submit"
                disabled={isSubmitting || questionAnswer.trim().length < 2}
                className="w-full py-3.5 px-4 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-bold tracking-tight transition-colors cursor-pointer text-center flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>Submit Answer to Join</span>
              </button>
            </form>
          )}
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
          loadGroupData();
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
