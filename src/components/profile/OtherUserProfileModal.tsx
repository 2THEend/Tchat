import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  User as UserIcon, 
  MessageSquare, 
  UserPlus, 
  UserCheck, 
  Clock, 
  Ban, 
  ShieldAlert, 
  AlertCircle, 
  Loader2, 
  Check, 
  Sparkles,
  Calendar,
  CheckCircle2,
  Trash2,
  Plus
} from 'lucide-react';
import { OtherUserProfile } from '../../domains/identity/types';
import { getOtherUserProfile } from '../../domains/identity/identityService';
import { 
  sendConnectionRequest, 
  acceptConnectionRequest, 
  declineConnectionRequest, 
  cancelConnectionRequest, 
  unfriendUser, 
  blockUser, 
  unblockUser 
} from '../../domains/connections/connectionsService';
import { getConversationStreaks, initiateStreak } from '../../domains/streaks/streaksService';
import { TchatStreak, StreakType } from '../../domains/streaks/types';
import { getStreakTypeIcon, formatStreakType, formatStreakDays } from '../conversations/streaks/StreakBadges';

interface OtherUserProfileModalProps {
  targetUserId: string | null;
  currentUserId: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenConversation?: (targetUserId: string, partnerProfile?: any) => void;
  onRelationshipChange?: () => void;
}

export const OtherUserProfileModal: React.FC<OtherUserProfileModalProps> = ({
  targetUserId,
  currentUserId,
  isOpen,
  onClose,
  onOpenConversation,
  onRelationshipChange,
}) => {
  const [profile, setProfile] = useState<OtherUserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Streaks state
  const [streaks, setStreaks] = useState<TchatStreak[]>([]);
  const [isLoadingStreaks, setIsLoadingStreaks] = useState<boolean>(false);
  const [showStartStreakPicker, setShowStartStreakPicker] = useState<boolean>(false);
  const [isStartingStreak, setIsStartingStreak] = useState<boolean>(false);

  // Connection request flow
  const [showConnectModal, setShowConnectModal] = useState<boolean>(false);
  const [connectContext, setConnectContext] = useState<string>('');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  // Safety confirmation states
  const [isConfirmingBlock, setIsConfirmingBlock] = useState<boolean>(false);
  const [isConfirmingUnfriend, setIsConfirmingUnfriend] = useState<boolean>(false);
  const [isActionInProgress, setIsActionInProgress] = useState<boolean>(false);

  // Load profile data
  const loadProfile = useCallback(async () => {
    if (!targetUserId) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await getOtherUserProfile(targetUserId, currentUserId);
      if (res.error) {
        setErrorMessage(res.error);
        setProfile(null);
      } else if (res.data) {
        setProfile(res.data);

        // If connected and conversation exists, load streaks
        if (res.data.relationship.status === 'connected' && res.data.relationship.conversation_id) {
          loadStreaks(res.data.relationship.conversation_id);
        } else {
          setStreaks([]);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load profile.';
      setErrorMessage(msg);
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  }, [targetUserId, currentUserId]);

  const loadStreaks = async (conversationId: string) => {
    setIsLoadingStreaks(true);
    try {
      const res = await getConversationStreaks(conversationId);
      if (res.data) {
        setStreaks(res.data);
      }
    } catch {
      // Non-blocking streak load error
    } finally {
      setIsLoadingStreaks(false);
    }
  };

  useEffect(() => {
    if (isOpen && targetUserId) {
      loadProfile();
      setShowConnectModal(false);
      setIsConfirmingBlock(false);
      setIsConfirmingUnfriend(false);
      setShowStartStreakPicker(false);
      setActionSuccess(null);
    } else {
      setProfile(null);
      setStreaks([]);
    }
  }, [isOpen, targetUserId, loadProfile]);

  if (!isOpen || !targetUserId) return null;

  // Handle Send Connection Request
  const handleSendConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserId) return;

    const trimmed = connectContext.trim();
    if (trimmed.length < 3) {
      setConnectError('Please provide at least 3 characters explaining why you want to connect.');
      return;
    }
    if (trimmed.length > 300) {
      setConnectError('Context note cannot exceed 300 characters.');
      return;
    }

    setIsConnecting(true);
    setConnectError(null);

    try {
      const res = await sendConnectionRequest(targetUserId, trimmed, currentUserId);
      if (!res.success) {
        setConnectError(res.error || 'Failed to send connection request.');
      } else {
        setShowConnectModal(false);
        setConnectContext('');
        setActionSuccess('Connection request sent.');
        setTimeout(() => setActionSuccess(null), 3500);
        await loadProfile();
        onRelationshipChange?.();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error sending request.';
      setConnectError(msg);
    } finally {
      setIsConnecting(false);
    }
  };

  // Handle Accept Connection Request
  const handleAcceptRequest = async (requestId: string) => {
    if (!targetUserId) return;
    setIsActionInProgress(true);
    try {
      const res = await acceptConnectionRequest(requestId, currentUserId, targetUserId);
      if (res.success) {
        setActionSuccess('Connection accepted.');
        setTimeout(() => setActionSuccess(null), 3500);
        await loadProfile();
        onRelationshipChange?.();
      } else {
        setErrorMessage(res.error || 'Failed to accept connection request.');
      }
    } finally {
      setIsActionInProgress(false);
    }
  };

  // Handle Decline Connection Request
  const handleDeclineRequest = async (requestId: string) => {
    if (!targetUserId) return;
    setIsActionInProgress(true);
    try {
      const res = await declineConnectionRequest(requestId, currentUserId, targetUserId);
      if (res.success) {
        setActionSuccess('Connection request declined.');
        setTimeout(() => setActionSuccess(null), 3500);
        await loadProfile();
        onRelationshipChange?.();
      } else {
        setErrorMessage(res.error || 'Failed to decline connection request.');
      }
    } finally {
      setIsActionInProgress(false);
    }
  };

  // Handle Cancel Sent Request
  const handleCancelRequest = async (requestId: string) => {
    if (!targetUserId) return;
    setIsActionInProgress(true);
    try {
      const res = await cancelConnectionRequest(requestId, targetUserId, currentUserId);
      if (res.success) {
        setActionSuccess('Connection request cancelled.');
        setTimeout(() => setActionSuccess(null), 3500);
        await loadProfile();
        onRelationshipChange?.();
      } else {
        setErrorMessage(res.error || 'Failed to cancel connection request.');
      }
    } finally {
      setIsActionInProgress(false);
    }
  };

  // Handle Unfriend
  const handleUnfriend = async () => {
    if (!targetUserId) return;
    setIsActionInProgress(true);
    try {
      const res = await unfriendUser(targetUserId, currentUserId);
      if (res.success) {
        setIsConfirmingUnfriend(false);
        setActionSuccess('Disconnected from user.');
        setTimeout(() => setActionSuccess(null), 3500);
        await loadProfile();
        onRelationshipChange?.();
      } else {
        setErrorMessage(res.error || 'Failed to disconnect.');
      }
    } finally {
      setIsActionInProgress(false);
    }
  };

  // Handle Block
  const handleBlock = async () => {
    if (!targetUserId) return;
    setIsActionInProgress(true);
    try {
      const res = await blockUser(targetUserId, currentUserId);
      if (res.success) {
        setIsConfirmingBlock(false);
        setActionSuccess('User blocked.');
        setTimeout(() => setActionSuccess(null), 3500);
        await loadProfile();
        onRelationshipChange?.();
      } else {
        setErrorMessage(res.error || 'Failed to block user.');
      }
    } finally {
      setIsActionInProgress(false);
    }
  };

  // Handle Unblock
  const handleUnblock = async () => {
    if (!targetUserId) return;
    setIsActionInProgress(true);
    try {
      const res = await unblockUser(targetUserId, currentUserId);
      if (res.success) {
        setActionSuccess('User unblocked.');
        setTimeout(() => setActionSuccess(null), 3500);
        await loadProfile();
        onRelationshipChange?.();
      } else {
        setErrorMessage(res.error || 'Failed to unblock user.');
      }
    } finally {
      setIsActionInProgress(false);
    }
  };

  // Handle Start Streak
  const handleStartStreak = async (type: StreakType) => {
    if (!profile?.relationship.conversation_id) return;
    setIsStartingStreak(true);
    try {
      const res = await initiateStreak(profile.relationship.conversation_id, type);
      if (res.error) {
        setErrorMessage(res.error);
      } else {
        setActionSuccess(`Requested ${formatStreakType(type)} Streak.`);
        setTimeout(() => setActionSuccess(null), 3500);
        setShowStartStreakPicker(false);
        loadStreaks(profile.relationship.conversation_id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to request streak.';
      setErrorMessage(msg);
    } finally {
      setIsStartingStreak(false);
    }
  };

  // Handle Message Tap
  const handleMessage = () => {
    if (!targetUserId || !profile) return;
    onClose();
    if (onOpenConversation) {
      onOpenConversation(targetUserId, {
        id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      });
    }
  };

  const status = profile?.relationship.status || 'not_connected';

  // Streaks breakdown
  const activeOrDormantStreaks = streaks.filter(
    (s) => s.state === 'active' || s.state === 'dormant'
  );
  const endedStreaks = streaks.filter((s) => s.state === 'ended');
  const existingStreakTypes = new Set(
    streaks.filter((s) => s.state !== 'ended').map((s) => s.type)
  );
  const availableStreakTypes: StreakType[] = (['chat', 'photo', 'video'] as StreakType[]).filter(
    (t) => !existingStreakTypes.has(t)
  );

  const memberDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <div
      id="other-user-profile-backdrop"
      className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="other-user-profile-sheet"
        className="w-full sm:max-w-md bg-stone-900 border border-stone-800 rounded-t-3xl sm:rounded-3xl flex flex-col max-h-[90vh] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800/80 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wider uppercase text-stone-400">
              Person Profile
            </span>
          </div>

          <button
            id="btn-close-other-profile"
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="w-8 h-8 rounded-xl flex items-center justify-center text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
              <p className="text-xs text-stone-400">Loading profile...</p>
            </div>
          ) : errorMessage && !profile ? (
            <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          ) : profile ? (
            <>
              {/* Notification Banner */}
              {actionSuccess && (
                <div className="p-3.5 rounded-2xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{actionSuccess}</span>
                </div>
              )}

              {/* Main Identity Surface */}
              <div 
                id="other-profile-identity-card"
                className="p-5 rounded-3xl bg-stone-950/60 border border-stone-800/80 space-y-4"
              >
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt={profile.display_name || profile.username}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <UserIcon className="w-8 h-8 stroke-[1.5]" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h2 className="text-lg font-semibold text-stone-100 truncate">
                        {profile.display_name || profile.username}
                      </h2>
                    </div>
                    <div className="text-xs text-stone-400 font-mono mt-0.5">
                      @{profile.username}
                    </div>
                    {memberDate && (
                      <div className="flex items-center gap-1 text-[10px] text-stone-400 mt-1">
                        <Calendar className="w-3 h-3 text-stone-400" />
                        <span>Member since {memberDate}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bio */}
                {profile.bio ? (
                  <p className="text-xs text-stone-300 leading-relaxed pt-2 border-t border-stone-800/60">
                    {profile.bio}
                  </p>
                ) : (
                  <p className="text-xs text-stone-400 italic pt-2 border-t border-stone-800/60">
                    No bio provided yet.
                  </p>
                )}
              </div>

              {/* Relationship & Primary Actions Surface */}
              <div className="space-y-3">
                {/* 1. Self State */}
                {status === 'self' && (
                  <div className="p-3.5 rounded-2xl bg-stone-900/60 border border-stone-800 text-stone-300 text-xs text-center">
                    This is your own profile.
                  </div>
                )}

                {/* 2. Connected State */}
                {status === 'connected' && (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        id="btn-profile-message"
                        type="button"
                        onClick={handleMessage}
                        className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-stone-100 hover:bg-white text-stone-900 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span>Message</span>
                      </button>

                      <span className="inline-flex items-center gap-1 px-3 py-3 rounded-2xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-400 text-xs font-medium">
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Connected</span>
                      </span>
                    </div>
                  </div>
                )}

                {/* 3. Not Connected State */}
                {status === 'not_connected' && !showConnectModal && (
                  <button
                    id="btn-profile-connect"
                    type="button"
                    onClick={() => setShowConnectModal(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-stone-100 hover:bg-white text-stone-900 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Connect</span>
                  </button>
                )}

                {/* 3a. Inline Connect Request Form */}
                {showConnectModal && (
                  <form
                    onSubmit={handleSendConnect}
                    className="p-4 rounded-2xl bg-stone-950/80 border border-stone-800 space-y-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-medium text-stone-200">
                        <span>Why do you want to connect?</span>
                        <span className="text-[10px] text-stone-400">
                          {connectContext.trim().length} / 300
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-400">
                        Tchat requires intentional context before connecting.
                      </p>
                    </div>

                    <textarea
                      id="input-profile-connect-context"
                      value={connectContext}
                      onChange={(e) => setConnectContext(e.target.value)}
                      placeholder="e.g. Met you during the design workshop..."
                      rows={3}
                      maxLength={300}
                      disabled={isConnecting}
                      className="w-full px-3 py-2 rounded-xl bg-stone-900 border border-stone-800 text-stone-100 placeholder-stone-400 text-xs focus:outline-none focus:border-stone-600 transition-colors resize-none leading-relaxed"
                    />

                    {connectError && (
                      <p className="text-xs text-rose-400">{connectError}</p>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setShowConnectModal(false);
                          setConnectContext('');
                          setConnectError(null);
                        }}
                        disabled={isConnecting}
                        className="flex-1 py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        id="btn-submit-profile-connect"
                        type="submit"
                        disabled={isConnecting || connectContext.trim().length < 3}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-stone-100 hover:bg-white text-stone-900 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {isConnecting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Sending...</span>
                          </>
                        ) : (
                          <span>Send Request</span>
                        )}
                      </button>
                    </div>
                  </form>
                )}

                {/* 4. Outgoing Request Pending State */}
                {status === 'request_sent' && (
                  <div className="p-3.5 rounded-2xl bg-amber-950/20 border border-amber-800/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        <span>Connection Request Pending</span>
                      </div>
                      {profile.relationship.pending_request_id && (
                        <button
                          type="button"
                          onClick={() => handleCancelRequest(profile.relationship.pending_request_id!)}
                          disabled={isActionInProgress}
                          className="text-[11px] text-stone-400 hover:text-stone-200 underline underline-offset-2 transition-colors cursor-pointer"
                        >
                          Cancel request
                        </button>
                      )}
                    </div>
                    {profile.relationship.request_context && (
                      <p className="text-[11px] text-stone-400 italic">
                        "{profile.relationship.request_context}"
                      </p>
                    )}
                  </div>
                )}

                {/* 5. Incoming Request Pending State */}
                {status === 'request_received' && profile.relationship.pending_request_id && (
                  <div className="p-4 rounded-2xl bg-stone-950/70 border border-stone-800 space-y-3">
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-stone-200">
                        Incoming Connection Request
                      </div>
                      {profile.relationship.request_context && (
                        <p className="text-[11px] text-stone-300 bg-stone-900 p-2.5 rounded-xl border border-stone-800/80 leading-relaxed italic">
                          "{profile.relationship.request_context}"
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDeclineRequest(profile.relationship.pending_request_id!)}
                        disabled={isActionInProgress}
                        className="flex-1 py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium transition-colors cursor-pointer"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAcceptRequest(profile.relationship.pending_request_id!)}
                        disabled={isActionInProgress}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {isActionInProgress ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Accept</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* 6. Blocked State (Caller blocked target) */}
                {status === 'blocked' && (
                  <div className="p-3.5 rounded-2xl bg-rose-950/20 border border-rose-900/40 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-rose-300">
                      <Ban className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>You have blocked this person</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleUnblock}
                      disabled={isActionInProgress}
                      className="px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium transition-colors cursor-pointer shrink-0"
                    >
                      Unblock
                    </button>
                  </div>
                )}

                {/* 7. Viewer Blocked State (Target blocked caller) */}
                {status === 'viewer_blocked' && (
                  <div className="p-3.5 rounded-2xl bg-stone-900/50 border border-stone-800 text-stone-400 text-xs flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-stone-400 shrink-0" />
                    <span>This account is not available for communication.</span>
                  </div>
                )}
              </div>

              {/* Continuity & Streaks Section (Only shown when Connected) */}
              {status === 'connected' && (
                <div 
                  id="other-profile-streaks-card"
                  className="p-4 rounded-3xl bg-stone-950/60 border border-stone-800/80 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-stone-300" />
                      <h3 className="text-xs font-semibold text-stone-200 uppercase tracking-wider">
                        Continuity & Streaks
                      </h3>
                    </div>

                    {availableStreakTypes.length > 0 && !showStartStreakPicker && (
                      <button
                        type="button"
                        onClick={() => setShowStartStreakPicker(true)}
                        className="flex items-center gap-1 text-[11px] text-stone-300 hover:text-stone-100 font-medium cursor-pointer transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Start Streak</span>
                      </button>
                    )}
                  </div>

                  {/* Streak picker if initiating */}
                  {showStartStreakPicker && (
                    <div className="p-3 rounded-2xl bg-stone-900/90 border border-stone-800 space-y-2">
                      <div className="flex items-center justify-between text-xs text-stone-300 font-medium">
                        <span>Select streak type:</span>
                        <button
                          type="button"
                          onClick={() => setShowStartStreakPicker(false)}
                          className="text-stone-400 hover:text-stone-200 text-[11px]"
                        >
                          Cancel
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {availableStreakTypes.map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => handleStartStreak(type)}
                            disabled={isStartingStreak}
                            className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 border border-stone-700/60 text-stone-200 transition-colors cursor-pointer"
                          >
                            {getStreakTypeIcon(type, 'w-4 h-4 text-stone-300')}
                            <span className="text-[11px] font-medium">{formatStreakType(type)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {isLoadingStreaks ? (
                    <div className="py-4 text-center text-xs text-stone-400">
                      Loading continuity data...
                    </div>
                  ) : activeOrDormantStreaks.length === 0 && endedStreaks.length === 0 ? (
                    <div className="py-3 text-center text-stone-400 text-xs">
                      No streaks active with {profile.display_name || profile.username}.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Active & Dormant Streaks */}
                      {activeOrDormantStreaks.map((s) => {
                        const isDormant = s.state === 'dormant';
                        return (
                          <div
                            key={s.id}
                            className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${
                              isDormant
                                ? 'bg-stone-900/40 border-stone-800/60 text-stone-400'
                                : 'bg-stone-900/80 border-stone-800 text-stone-200'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-xl bg-stone-800 flex items-center justify-center text-stone-300 shrink-0">
                                {getStreakTypeIcon(s.type, 'w-4 h-4')}
                              </div>
                              <div>
                                <div className="text-xs font-semibold text-stone-200">
                                  {formatStreakType(s.type)} Streak
                                </div>
                                <div className="text-[11px] font-mono text-stone-400">
                                  {formatStreakDays(s.progress_count)}
                                </div>
                              </div>
                            </div>

                            <span
                              className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                                isDormant
                                  ? 'bg-amber-950/40 text-amber-400 border border-amber-800/40'
                                  : 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/40'
                              }`}
                            >
                              {isDormant ? 'Dormant' : 'Active'}
                            </span>
                          </div>
                        );
                      })}

                      {/* Ended Streaks (Preserved Continuity) */}
                      {endedStreaks.map((s) => (
                        <div
                          key={s.id}
                          className="p-2.5 rounded-2xl bg-stone-950/40 border border-stone-900 flex items-center justify-between gap-2 text-stone-400 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {getStreakTypeIcon(s.type, 'w-3.5 h-3.5 text-stone-400')}
                            <span className="truncate">
                              {formatStreakType(s.type)} Streak · {formatStreakDays(s.progress_count)}
                            </span>
                          </div>
                          <span className="text-[10px] text-stone-400 font-mono shrink-0">
                            Preserved
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Safety & Relationship Management (Block & Unfriend) */}
              {status !== 'self' && status !== 'viewer_blocked' && (
                <div className="pt-2 border-t border-stone-800/60 space-y-2">
                  {/* Unfriend Section (Only for connected users) */}
                  {status === 'connected' && (
                    <>
                      {isConfirmingUnfriend ? (
                        <div className="p-3.5 rounded-2xl bg-stone-950/80 border border-stone-800 space-y-2.5">
                          <p className="text-xs text-stone-300">
                            Disconnect from {profile.display_name || profile.username}? This will remove your connection.
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setIsConfirmingUnfriend(false)}
                              disabled={isActionInProgress}
                              className="flex-1 py-1.5 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleUnfriend}
                              disabled={isActionInProgress}
                              className="flex-1 py-1.5 px-3 rounded-xl bg-rose-950/60 border border-rose-900 text-rose-300 hover:bg-rose-900/60 text-xs font-medium cursor-pointer"
                            >
                              Disconnect
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsConfirmingUnfriend(true)}
                          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-stone-400 hover:text-stone-300 hover:bg-stone-800/40 text-xs font-medium transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Disconnect from user</span>
                        </button>
                      )}
                    </>
                  )}

                  {/* Block Section */}
                  {status !== 'blocked' && (
                    <>
                      {isConfirmingBlock ? (
                        <div className="p-3.5 rounded-2xl bg-stone-950/80 border border-stone-800 space-y-2.5">
                          <p className="text-xs text-rose-300">
                            Block @{profile.username}? They will no longer be able to message, find, or request connections with you.
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setIsConfirmingBlock(false)}
                              disabled={isActionInProgress}
                              className="flex-1 py-1.5 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleBlock}
                              disabled={isActionInProgress}
                              className="flex-1 py-1.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer"
                            >
                              Block User
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsConfirmingBlock(true)}
                          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-stone-400 hover:text-rose-400 hover:bg-rose-950/10 text-xs font-medium transition-colors cursor-pointer"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Block @{profile.username}</span>
                        </button>
                      )}
                    </>
                  )}

                  {/* Report Note (Safety Release Notice) */}
                  <div className="p-3 rounded-2xl bg-stone-950/40 border border-stone-800/40 text-[11px] text-stone-400 leading-relaxed text-center">
                    User reporting system is scheduled for the upcoming Safety release. To immediately prevent all contact, use Block above.
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
