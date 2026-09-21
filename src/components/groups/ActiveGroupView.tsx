import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  ArrowLeft, 
  Users, 
  Clock, 
  ShieldCheck, 
  Shield, 
  Star, 
  User as UserIcon, 
  Inbox, 
  MessageSquare, 
  Info, 
  Lock, 
  Globe,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { 
  GroupDetails, 
  GroupMessage, 
  GroupMessageMedia, 
  GroupRole, 
  TchatGroupMember 
} from '../../domains/groups/types';
import { GroupMembersModal } from './GroupMembersModal';
import { GroupJoinRequestsModal } from './GroupJoinRequestsModal';
import { GroupLeaveModal } from './GroupLeaveModal';
import { GroupMessageBubble } from './GroupMessageBubble';
import { GroupMessageComposer } from './GroupMessageComposer';
import { 
  getGroupDetails, 
  getGroupJoinRequests, 
  listGroupMembers, 
  getGroupMessages, 
  markGroupMessagesRead, 
  sendGroupMessage, 
  uploadGroupMediaFile 
} from '../../domains/groups/groupsService';
import { 
  subscribeToGroupMessages, 
  resyncGroupMessages 
} from '../../domains/groups/realtime';
import { onGroupEvent } from '../../domains/groups/events';

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
  // Modal states
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [isRequestsModalOpen, setIsRequestsModalOpen] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);

  // Message stream states
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false);
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Member cache for enriching realtime messages
  const memberCacheRef = useRef<Map<string, TchatGroupMember>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const userRole: GroupRole = group.membership?.role || 'member';
  const isAdminOrMod = userRole === 'admin' || userRole === 'mod';

  const isExpired = new Date(group.expires_at).getTime() <= Date.now();
  const isGroupActive = group.lifecycle_status === 'active' && !isExpired;

  // Formatted date/lifetime
  const expiresDate = new Date(group.expires_at);
  const expiresFormatted = expiresDate.toLocaleDateString(undefined, {
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

  // 1. Fetch group members to populate member cache for sender resolution
  useEffect(() => {
    let isMounted = true;
    listGroupMembers(group.id).then((res) => {
      if (isMounted && res.data) {
        const cache = new Map<string, TchatGroupMember>();
        res.data.forEach((m) => cache.set(m.user_id, m));
        memberCacheRef.current = cache;
      }
    });
    return () => {
      isMounted = false;
    };
  }, [group.id]);

  // 2. Fetch pending requests for Admin/Mod
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

  // 3. Mark messages read helper (advances read marker forward)
  const advanceReadMarker = useCallback(async (msgId: string) => {
    try {
      await markGroupMessagesRead(group.id, msgId);
    } catch {
      // Non-blocking
    }
  }, [group.id]);

  // 4. Initial messages fetch
  useEffect(() => {
    let isMounted = true;
    setIsLoadingMessages(true);
    setFetchError(null);

    getGroupMessages(group.id, 50).then((res) => {
      if (!isMounted) return;
      setIsLoadingMessages(false);

      if (res.error) {
        setFetchError(res.error);
        return;
      }

      if (res.data) {
        setMessages(res.data);
        setHasMoreOlder(res.data.length >= 50);

        // Mark latest message as read if present
        if (res.data.length > 0) {
          const latest = res.data[res.data.length - 1];
          advanceReadMarker(latest.id);
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [group.id, advanceReadMarker]);

  // Auto-scroll to bottom when messages load or change
  useEffect(() => {
    if (!isLoadingMessages) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isLoadingMessages]);

  // 5. Load older messages (pagination)
  const handleLoadOlder = async () => {
    if (isLoadingOlder || messages.length === 0) return;

    const oldestMsg = messages[0];
    const beforeSeq = oldestMsg.sequence_number;
    setIsLoadingOlder(true);

    const res = await getGroupMessages(group.id, 30, beforeSeq);
    setIsLoadingOlder(false);

    if (res.data && res.data.length > 0) {
      setMessages((prev) => [...res.data!, ...prev]);
      setHasMoreOlder(res.data.length >= 30);
    } else {
      setHasMoreOlder(false);
    }
  };

  // 6. Realtime subscription
  useEffect(() => {
    const unsub = subscribeToGroupMessages({
      groupId: group.id,
      onMessage: (rawMessage) => {
        setMessages((prev) => {
          // Avoid duplicate insertions
          if (prev.some((m) => m.id === rawMessage.id)) {
            return prev;
          }

          // Enrich sender if missing
          let enriched = { ...rawMessage };
          if (!enriched.sender) {
            const cachedMember = memberCacheRef.current.get(rawMessage.sender_id);
            if (cachedMember) {
              enriched.sender = {
                id: cachedMember.user_id,
                username: cachedMember.username,
                display_name: cachedMember.display_name,
                avatar_url: cachedMember.avatar_url,
                role: cachedMember.role,
              };
            }
          }

          // If message has media attachment without full media payload, trigger catchup
          if (rawMessage.media_asset_id && !rawMessage.media) {
            getGroupMessages(group.id, 5, undefined, rawMessage.sequence_number - 1).then((res) => {
              if (res.data && res.data.length > 0) {
                setMessages((curr) => {
                  const updated = [...curr];
                  res.data!.forEach((m) => {
                    const idx = updated.findIndex((u) => u.id === m.id);
                    if (idx >= 0) {
                      updated[idx] = m;
                    }
                  });
                  return updated;
                });
              }
            });
          }

          return [...prev, enriched];
        });

        // Advance read marker
        advanceReadMarker(rawMessage.id);
      },
      onResyncRequired: async () => {
        // Resync from last known sequence number
        const lastSeq = messages.length > 0 ? messages[messages.length - 1].sequence_number : 0;
        const catchup = await resyncGroupMessages(group.id, lastSeq);
        if (catchup.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const fresh = catchup.filter((m) => !existingIds.has(m.id));
            return [...prev, ...fresh];
          });
        }
      },
      onError: (err) => {
        console.warn('[ActiveGroupView] Realtime subscription notice:', err);
      },
    });

    return unsub;
  }, [group.id, messages, advanceReadMarker]);

  // 7. Domain event listeners
  useEffect(() => {
    const unsub = onGroupEvent((evt) => {
      if (evt.groupId !== group.id) return;

      if (evt.type === 'group:media_saved' && evt.payload?.mediaAssetId) {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.media && msg.media.id === evt.payload?.mediaAssetId) {
              return {
                ...msg,
                media: {
                  ...msg.media,
                  is_saved: true,
                },
              };
            }
            return msg;
          })
        );
      }

      if (
        evt.type === 'group:member_removed' ||
        evt.type === 'group:member_banned' ||
        evt.type === 'group:role_changed'
      ) {
        onRefreshGroup();
      }
    });

    return unsub;
  }, [group.id, onRefreshGroup]);

  // 8. Send message handler
  const handleSendMessage = async (content: string, mediaAssetId?: string) => {
    const res = await sendGroupMessage(
      group.id,
      content,
      mediaAssetId ? 'media' : 'text',
      mediaAssetId
    );

    if (res.error) {
      return { error: res.error };
    }

    if (res.data) {
      // Authoritative message returned by RPC
      const authoritativeMsg: GroupMessage = res.data;
      setMessages((prev) => {
        if (prev.some((m) => m.id === authoritativeMsg.id)) {
          return prev;
        }
        return [...prev, authoritativeMsg];
      });

      advanceReadMarker(authoritativeMsg.id);
    }

    return { error: null };
  };

  // 9. Upload media handler
  const handleUploadMedia = async (file: File, options?: { allowRecipientSave?: boolean }) => {
    return await uploadGroupMediaFile(group.id, file, options);
  };

  // 10. Saved media in-state updater
  const handleMediaSaved = (updatedAsset: GroupMessageMedia) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.media && msg.media.id === updatedAsset.id) {
          return {
            ...msg,
            media: updatedAsset,
          };
        }
        return msg;
      })
    );
  };

  const renderRoleBadge = (role: GroupRole) => {
    switch (role) {
      case 'admin':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-[10px] font-semibold text-emerald-300">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span>Admin</span>
          </span>
        );
      case 'mod':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-950/80 border border-blue-700/60 text-[10px] font-semibold text-blue-300">
            <Shield className="w-3 h-3 text-blue-400" />
            <span>Mod</span>
          </span>
        );
      case 'special':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-700/60 text-[10px] font-semibold text-amber-300">
            <Star className="w-3 h-3 text-amber-400" />
            <span>Special</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-900 border border-stone-800 text-[10px] font-medium text-stone-300">
            <UserIcon className="w-3 h-3 text-stone-400" />
            <span>Member</span>
          </span>
        );
    }
  };

  return (
    <div 
      id="active-group-view" 
      className="flex-1 flex flex-col h-full bg-stone-950 text-stone-100 selection:bg-stone-800 overflow-hidden"
    >
      {/* 1. Header (Group metadata, member count, lifecycle, back navigation) */}
      <header className="shrink-0 bg-stone-950/95 backdrop-blur-md px-4 py-3 border-b border-stone-900 flex items-center justify-between z-20">
        <div className="flex items-center gap-3 min-w-0">
          <button
            id="btn-back-to-home-from-group"
            type="button"
            onClick={onBackToHome}
            className="p-2 -ml-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
            title="Back to Home"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          {/* Group Avatar / Cover */}
          <div 
            className="w-9 h-9 rounded-xl bg-stone-900 border border-stone-800 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer"
            onClick={onViewDetails}
            title="View group details"
          >
            {group.cover_url ? (
              <img 
                src={group.cover_url} 
                alt={group.name} 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <Users className="w-4 h-4 text-stone-400" />
            )}
          </div>

          {/* Name & Reason summary */}
          <div 
            className="min-w-0 cursor-pointer"
            onClick={onViewDetails}
          >
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-semibold text-stone-100 truncate">
                {group.name}
              </h1>
              {renderRoleBadge(userRole)}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-stone-400">
              <span className="inline-flex items-center gap-1 text-stone-400">
                <Clock className="w-3 h-3 text-amber-400" />
                <span>Expires {expiresFormatted}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Members Button */}
          <button
            id="btn-open-group-members-header"
            type="button"
            onClick={() => setIsMembersModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 text-xs font-medium border border-stone-800 transition-colors cursor-pointer"
            title="View Members"
          >
            <Users className="w-3.5 h-3.5 text-stone-400" />
            <span>{group.member_count}</span>
          </button>

          {/* Details / Settings Button */}
          <button
            id="btn-open-group-details-header"
            type="button"
            onClick={onViewDetails}
            className="p-2 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
            title="Group Information"
            aria-label="Group Information"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Admin/Mod Pending Requests Notification Banner */}
      {isAdminOrMod && pendingRequestsCount > 0 && (
        <div
          id="active-group-pending-requests-banner"
          onClick={() => setIsRequestsModalOpen(true)}
          className="shrink-0 px-4 py-2 bg-amber-950/40 border-b border-amber-900/40 flex items-center justify-between text-xs text-amber-300 cursor-pointer hover:bg-amber-950/60 transition-colors select-none"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Inbox className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="truncate">
              {pendingRequestsCount} join {pendingRequestsCount === 1 ? 'request' : 'requests'} waiting for review
            </span>
          </div>
          <span className="px-2 py-0.5 rounded-lg bg-amber-900/60 text-[11px] font-medium text-amber-200 shrink-0">
            Review
          </span>
        </div>
      )}

      {/* 2. Message Stream Container */}
      <div 
        ref={scrollContainerRef}
        id="group-message-stream"
        className="flex-1 overflow-y-auto px-4 py-4 space-y-1"
      >
        {/* Loading State */}
        {isLoadingMessages && (
          <div className="flex flex-col items-center justify-center py-12 text-stone-500 gap-2">
            <div className="w-5 h-5 border-2 border-stone-700 border-t-stone-300 rounded-full animate-spin" />
            <p className="text-xs">Loading conversation...</p>
          </div>
        )}

        {/* Fetch Error State */}
        {!isLoadingMessages && fetchError && (
          <div className="my-6 p-4 rounded-2xl bg-rose-950/30 border border-rose-900/50 text-rose-300 text-xs flex flex-col items-center text-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-400" />
            <p>{fetchError}</p>
            <button
              type="button"
              onClick={() => {
                setIsLoadingMessages(true);
                setFetchError(null);
                getGroupMessages(group.id, 50).then((res) => {
                  setIsLoadingMessages(false);
                  if (res.data) setMessages(res.data);
                  if (res.error) setFetchError(res.error);
                });
              }}
              className="mt-1 px-3 py-1 rounded-xl bg-stone-900 text-stone-200 border border-stone-800 hover:bg-stone-800 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Load Older Messages Button */}
        {!isLoadingMessages && hasMoreOlder && (
          <div className="flex justify-center pb-3">
            <button
              type="button"
              id="btn-load-older-group-messages"
              onClick={handleLoadOlder}
              disabled={isLoadingOlder}
              className="px-3.5 py-1.5 rounded-full bg-stone-900 hover:bg-stone-800 text-stone-400 hover:text-stone-200 text-xs border border-stone-800/80 transition-colors cursor-pointer flex items-center gap-2"
            >
              {isLoadingOlder ? (
                <div className="w-3.5 h-3.5 border-2 border-stone-600 border-t-stone-300 rounded-full animate-spin" />
              ) : null}
              <span>Load earlier messages</span>
            </button>
          </div>
        )}

        {/* Empty State (Intentional, Calm temporary space context) */}
        {!isLoadingMessages && !fetchError && messages.length === 0 && (
          <div 
            id="group-empty-state"
            className="h-full flex flex-col items-center justify-center p-6 text-center select-none"
          >
            <div className="w-12 h-12 rounded-2xl bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-400 mb-3">
              <MessageSquare className="w-5 h-5" />
            </div>
            <h2 className="text-sm font-semibold text-stone-200 mb-1">
              Welcome to {group.name}
            </h2>
            <p className="text-xs text-stone-400 max-w-xs leading-relaxed mb-3">
              This space is active until <span className="text-stone-300 font-medium">{expiresFormatted}</span>.
              Share intentional thoughts, ideas, or ephemeral media with your fellow members.
            </p>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-stone-900/60 border border-stone-800 text-[11px] text-amber-400">
              <Clock className="w-3 h-3" />
              <span>{lifetimeLabel} Lifetime</span>
            </div>
          </div>
        )}

        {/* Message Stream */}
        {!isLoadingMessages && messages.map((msg, index) => {
          const prevMsg = index > 0 ? messages[index - 1] : null;
          const isSameSender = prevMsg ? prevMsg.sender_id === msg.sender_id : false;
          const isCloseInTime = prevMsg 
            ? new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 5 * 60 * 1000 
            : false;
          
          // Show sender info if first message or different sender or significant time gap
          const showSenderHeader = !isSameSender || !isCloseInTime || msg.message_type === 'system';

          return (
            <GroupMessageBubble
              key={msg.id}
              message={msg}
              currentUserId={currentUserId}
              groupId={group.id}
              showSenderHeader={showSenderHeader}
              onMediaSaved={handleMediaSaved}
            />
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. Composer (Lifecycle-aware, text & ephemeral media) */}
      <div className="shrink-0">
        <GroupMessageComposer
          groupId={group.id}
          isGroupActive={isGroupActive}
          lifecycleStatus={group.lifecycle_status}
          onSendMessage={handleSendMessage}
          onUploadMedia={handleUploadMedia}
        />
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
