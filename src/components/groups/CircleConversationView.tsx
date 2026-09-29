import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  ArrowLeft, 
  Users, 
  Clock, 
  Sparkles, 
  LogOut, 
  PowerOff, 
  AlertCircle, 
  Loader2, 
  Send, 
  Paperclip, 
  UserPlus, 
  Check,
  Lock,
  X,
  AlertTriangle
} from 'lucide-react';
import { 
  CircleMessage, 
  GroupDetails, 
  TchatCircle 
} from '../../domains/groups/types';
import { 
  getCircleDetails, 
  getCircleMessages, 
  joinCircle, 
  leaveCircle, 
  endCircle, 
  sendCircleMessage, 
  markCircleMessagesRead, 
  uploadCircleMediaFile 
} from '../../domains/groups/circlesService';
import { 
  subscribeToCircleMessages, 
  resyncCircleMessages 
} from '../../domains/groups/realtime';
import { CircleMembersModal } from './CircleMembersModal';
import { GroupMediaBubble } from './GroupMediaBubble';

interface CircleConversationViewProps {
  circle: TchatCircle;
  parentGroup: GroupDetails;
  currentUserId: string;
  onBackToGroup: () => void;
  onCircleUpdated?: () => void;
}

export function CircleConversationView({
  circle: initialCircle,
  parentGroup,
  currentUserId,
  onBackToGroup,
  onCircleUpdated,
}: CircleConversationViewProps) {
  const [circle, setCircle] = useState<TchatCircle>(initialCircle);
  const [messages, setMessages] = useState<CircleMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Modals & Action States
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // In-app Confirmation Modals (Replacing browser-native window.confirm)
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [isEndModalOpen, setIsEndModalOpen] = useState(false);

  // Message input state
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isExpired = circle.lifecycle_status === 'expired' || new Date(circle.expires_at).getTime() <= Date.now();
  const isParentGroupActive = parentGroup.lifecycle_status === 'active' && new Date(parentGroup.expires_at).getTime() > Date.now();
  const canInteract = circle.lifecycle_status === 'active' && !isExpired && isParentGroupActive && circle.is_member;

  const isAdminOrMod = parentGroup.membership?.role === 'admin' || parentGroup.membership?.role === 'mod';
  const canEndCircle = (circle.created_by === currentUserId || isAdminOrMod) && !isExpired;

  // Refresh circle details
  const refreshCircle = useCallback(async () => {
    const res = await getCircleDetails(circle.id);
    if (res.data) {
      setCircle(res.data);
    }
  }, [circle.id]);

  // Advance read marker
  const advanceReadMarker = useCallback(async (msgId: string) => {
    if (!circle.is_member) return;
    await markCircleMessagesRead(circle.id, msgId);
  }, [circle.id, circle.is_member]);

  // Load messages
  useEffect(() => {
    let isMounted = true;
    setIsLoadingMessages(true);
    setFetchError(null);

    getCircleMessages(circle.id, 50).then((res) => {
      if (!isMounted) return;
      setIsLoadingMessages(false);
      if (res.data) {
        setMessages(res.data);
        if (res.data.length > 0) {
          advanceReadMarker(res.data[res.data.length - 1].id);
        }
      }
      if (res.error) setFetchError(res.error);
    });

    return () => {
      isMounted = false;
    };
  }, [circle.id, advanceReadMarker]);

  // Realtime subscription
  useEffect(() => {
    const unsub = subscribeToCircleMessages({
      circleId: circle.id,
      onMessage: (newMsg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        advanceReadMarker(newMsg.id);
      },
      onResyncRequired: async () => {
        const lastSeq = messages.length > 0 ? messages[messages.length - 1].sequence_number : 0;
        const catchup = await resyncCircleMessages(circle.id, lastSeq);
        if (catchup.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const fresh = catchup.filter((m) => !existingIds.has(m.id));
            return [...prev, ...fresh];
          });
        }
      },
    });

    return unsub;
  }, [circle.id, messages, advanceReadMarker]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle Send Text
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSending || !canInteract) return;

    const content = inputText.trim();
    setInputText('');
    setIsSending(true);

    const res = await sendCircleMessage(circle.id, content, 'text');
    setIsSending(false);

    if (res.data) {
      const sentMsg = res.data;
      setMessages((prev) => {
        if (prev.some((m) => m.id === sentMsg.id)) return prev;
        return [...prev, sentMsg];
      });
      advanceReadMarker(sentMsg.id);
    } else if (res.error) {
      setActionError(res.error);
    }
  };

  // Handle Media Attachment
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canInteract) return;

    setIsUploadingMedia(true);
    setActionError(null);

    const uploadRes = await uploadCircleMediaFile(circle.id, parentGroup.id, file);
    if (uploadRes.data) {
      const sendRes = await sendCircleMessage(circle.id, file.name, 'media', uploadRes.data.id);
      if (sendRes.data) {
        const sentMsg = sendRes.data;
        setMessages((prev) => {
          if (prev.some((m) => m.id === sentMsg.id)) return prev;
          return [...prev, sentMsg];
        });
      }
    } else if (uploadRes.error) {
      setActionError(uploadRes.error);
    }

    setIsUploadingMedia(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Join Circle
  const handleJoinCircle = async () => {
    setIsActionPending(true);
    setActionError(null);
    const res = await joinCircle(circle.id);
    setIsActionPending(false);

    if (res.data) {
      setCircle((prev) => ({
        ...prev,
        is_member: true,
        member_count: res.data.member_count,
      }));
      onCircleUpdated?.();
      // Reload messages once joined
      getCircleMessages(circle.id, 50).then((mRes) => {
        if (mRes.data) setMessages(mRes.data);
      });
    } else if (res.error) {
      setActionError(res.error);
    }
  };

  // In-app Leave Circle Action
  const executeLeaveCircle = async () => {
    setIsActionPending(true);
    setActionError(null);
    const res = await leaveCircle(circle.id);
    setIsActionPending(false);
    setIsLeaveModalOpen(false);

    if (res.data) {
      setCircle((prev) => ({
        ...prev,
        is_member: false,
        member_count: res.data.member_count,
      }));
      onCircleUpdated?.();
    } else if (res.error) {
      setActionError(res.error);
    }
  };

  // In-app End Circle Action
  const executeEndCircle = async () => {
    setIsActionPending(true);
    setActionError(null);
    const res = await endCircle(circle.id);
    setIsActionPending(false);
    setIsEndModalOpen(false);

    if (res.data) {
      setCircle((prev) => ({
        ...prev,
        lifecycle_status: 'expired',
        ended_at: res.data.ended_at,
      }));
      onCircleUpdated?.();
    } else if (res.error) {
      setActionError(res.error);
    }
  };

  // Time remaining format
  const formatRemaining = (expiresAt: string) => {
    const diffMs = new Date(expiresAt).getTime() - Date.now();
    if (diffMs <= 0) return 'Ended';
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h left`;
    return `${Math.max(1, mins)}m left`;
  };

  return (
    <div 
      id="circle-conversation-view" 
      className="flex-1 flex flex-col h-full bg-stone-950 text-stone-100 selection:bg-stone-800 overflow-hidden"
    >
      {/* 1. Header (Restructured for mobile: title priority, secondary info on line 2, compact actions) */}
      <header className="shrink-0 bg-stone-950/95 backdrop-blur-md px-3 sm:px-4 py-2.5 border-b border-stone-900 flex items-center justify-between gap-2 z-20">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBackToGroup}
            className="p-1.5 -ml-1 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer shrink-0"
            title="Back to Group"
            aria-label="Back to Group"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="w-8 h-8 rounded-xl bg-amber-950/80 border border-amber-700/60 flex items-center justify-center shrink-0 text-amber-400">
            <Sparkles className="w-4 h-4" />
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold text-stone-100 truncate leading-snug">
              {circle.name}
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] text-stone-400 truncate leading-tight">
              <span className="truncate text-stone-400">
                Inside <span className="text-stone-300 font-medium">{parentGroup.name}</span>
              </span>
              <span className="text-stone-600 shrink-0">•</span>
              <span className={`shrink-0 font-mono text-[10px] ${isExpired ? 'text-stone-500' : 'text-amber-400/90'}`}>
                {formatRemaining(circle.expires_at)}
              </span>
              {circle.reason && (
                <>
                  <span className="text-stone-600 shrink-0">•</span>
                  <span className="truncate text-stone-400">{circle.reason}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Members Button */}
          <button
            type="button"
            onClick={() => setIsMembersModalOpen(true)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 text-xs font-medium border border-stone-800 transition-colors cursor-pointer"
            title="View Circle Members"
          >
            <Users className="w-3.5 h-3.5 text-stone-400" />
            <span>{circle.member_count}</span>
          </button>

          {/* Join button for non-members */}
          {!circle.is_member && !isExpired && (
            <button
              type="button"
              onClick={handleJoinCircle}
              disabled={isActionPending}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-semibold transition-colors cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Join</span>
            </button>
          )}

          {/* Leave Button */}
          {circle.is_member && !isExpired && (
            <button
              type="button"
              onClick={() => setIsLeaveModalOpen(true)}
              disabled={isActionPending}
              className="p-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
              title="Leave Circle"
              aria-label="Leave Circle"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}

          {/* End Button */}
          {canEndCircle && (
            <button
              type="button"
              onClick={() => setIsEndModalOpen(true)}
              disabled={isActionPending}
              className="p-1.5 rounded-xl hover:bg-rose-950/60 text-stone-400 hover:text-rose-300 transition-colors cursor-pointer"
              title="End Circle Early"
              aria-label="End Circle Early"
            >
              <PowerOff className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Action / Error Banner */}
      {actionError && (
        <div className="shrink-0 px-4 py-2 bg-rose-950/40 border-b border-rose-900/40 flex items-center justify-between text-xs text-rose-300">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="truncate">{actionError}</span>
          </div>
          <button 
            type="button" 
            onClick={() => setActionError(null)} 
            className="text-stone-400 hover:text-stone-200 text-xs font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Status Warning Banners */}
      {isExpired && (
        <div className="shrink-0 px-4 py-2 bg-stone-900/80 border-b border-stone-800 text-stone-400 text-xs flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-stone-500" />
          <span>This circle has ended. Message history is preserved for reference.</span>
        </div>
      )}

      {!isParentGroupActive && (
        <div className="shrink-0 px-4 py-2 bg-amber-950/40 border-b border-amber-900/40 text-amber-300 text-xs flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-amber-400" />
          <span>The parent group is in closing/read-only mode. New interactions are disabled.</span>
        </div>
      )}

      {/* 2. Message Stream */}
      <div 
        ref={scrollContainerRef}
        id="circle-message-stream"
        className="flex-1 overflow-y-auto px-4 py-4 space-y-2"
      >
        {isLoadingMessages ? (
          <div className="flex flex-col items-center justify-center py-16 text-stone-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <p className="text-xs">Loading circle conversation...</p>
          </div>
        ) : fetchError ? (
          <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-900/50 text-rose-300 text-xs text-center space-y-2">
            <p>{fetchError}</p>
            {!circle.is_member && (
              <button
                type="button"
                onClick={handleJoinCircle}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Join Circle to View Messages</span>
              </button>
            )}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-stone-500 space-y-2 text-center">
            <div className="w-10 h-10 rounded-2xl bg-stone-900 border border-stone-800 flex items-center justify-center text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <p className="text-xs text-stone-400 font-medium">Welcome to {circle.name}</p>
            <p className="text-[11px] text-stone-500 max-w-xs">
              This is a temporary side space for group members. Send the first message!
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === currentUserId;
            const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

            return (
              <div 
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1`}
              >
                {!isMe && (
                  <span className="text-[10px] text-stone-500 px-1">
                    {msg.sender_display_name || msg.sender_username || 'Member'}
                  </span>
                )}

                {/* Message Bubble Container: Clean, unpadded media + neutral text bubble */}
                <div className={`max-w-[85%] sm:max-w-[75%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  {/* Standalone Ephemeral Media Attachment */}
                  {msg.media && (
                    <div className="mb-1">
                      <GroupMediaBubble 
                        media={msg.media} 
                        groupId={parentGroup.id}
                        isMine={isMe} 
                        currentUserId={currentUserId}
                        context="circle"
                      />
                    </div>
                  )}

                  {/* Neutral Text Bubble (Neutral Tchat visual language) */}
                  {msg.content && msg.content.trim().length > 0 && (!msg.media || msg.content !== msg.media.original_filename) && (
                    <div
                      className={`px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed break-words ${
                        isMe
                          ? 'bg-stone-800 text-stone-100 border border-stone-700/60 rounded-br-sm'
                          : 'bg-stone-900/90 text-stone-200 border border-stone-800/80 rounded-bl-sm'
                      }`}
                    >
                      {msg.content}
                    </div>
                  )}

                  {/* Timestamp */}
                  <div className="flex items-center gap-1 mt-0.5 px-1">
                    <span className="text-[10px] text-stone-500 select-none">
                      {timeStr}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 3. Composer or Join Prompt */}
      {!circle.is_member ? (
        <div className="shrink-0 p-4 bg-stone-900/90 border-t border-stone-800/80 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-stone-200">Join {circle.name}</p>
            <p className="text-[11px] text-stone-500">Participate in this spontaneous side space</p>
          </div>
          <button
            type="button"
            onClick={handleJoinCircle}
            disabled={isActionPending || isExpired}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-semibold disabled:opacity-50 transition-colors cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Join Circle</span>
          </button>
        </div>
      ) : canInteract ? (
        <form 
          onSubmit={handleSend}
          className="shrink-0 p-3 bg-stone-950/95 border-t border-stone-900 flex items-center gap-2"
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange}
            accept="image/*,video/*,audio/*,.pdf,.txt"
            className="hidden" 
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingMedia || isSending}
            className="p-2.5 rounded-xl bg-stone-900 border border-stone-800 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer disabled:opacity-50"
            title="Attach media"
            aria-label="Attach media"
          >
            {isUploadingMedia ? (
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
            ) : (
              <Paperclip className="w-4 h-4" />
            )}
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Message ${circle.name}...`}
            maxLength={1000}
            disabled={isSending}
            className="flex-1 px-4 py-2.5 bg-stone-900 border border-stone-800 rounded-xl text-stone-100 placeholder-stone-500 text-xs sm:text-sm focus:outline-none focus:border-stone-700 transition-colors"
          />

          <button
            type="submit"
            disabled={!inputText.trim() || isSending}
            className="p-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 disabled:opacity-40 disabled:hover:bg-stone-800 transition-colors cursor-pointer shrink-0"
            aria-label="Send message"
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      ) : null}

      {/* 4. Circle Members Modal */}
      {isMembersModalOpen && (
        <CircleMembersModal
          circleId={circle.id}
          circleName={circle.name}
          isOpen={isMembersModalOpen}
          onClose={() => setIsMembersModalOpen(false)}
        />
      )}

      {/* 5. In-App Confirmation Modal: Leave Circle */}
      {isLeaveModalOpen && (
        <div 
          id="leave-circle-modal-overlay"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
          onClick={() => setIsLeaveModalOpen(false)}
        >
          <div 
            id="leave-circle-modal-container"
            className="w-full sm:max-w-md bg-stone-900 border-t sm:border border-stone-800 rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl space-y-5 animate-in slide-in-from-bottom duration-200 text-stone-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-1 border-b border-stone-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-stone-800 border border-stone-700 flex items-center justify-center text-stone-300">
                  <LogOut className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-stone-100">Leave Circle</h2>
                  <p className="text-xs text-stone-400">Exit this temporary side space</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsLeaveModalOpen(false)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-stone-300 leading-relaxed">
              Are you sure you want to leave <strong>{circle.name}</strong>? You can rejoin anytime while it remains active, and your parent group membership is untouched.
            </p>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsLeaveModalOpen(false)}
                disabled={isActionPending}
                className="flex-1 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeLeaveCircle}
                disabled={isActionPending}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                {isActionPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Leaving...</span>
                  </>
                ) : (
                  <span>Leave Circle</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. In-App Confirmation Modal: End Circle Early */}
      {isEndModalOpen && (
        <div 
          id="end-circle-modal-overlay"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
          onClick={() => setIsEndModalOpen(false)}
        >
          <div 
            id="end-circle-modal-container"
            className="w-full sm:max-w-md bg-stone-900 border-t sm:border border-stone-800 rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl space-y-5 animate-in slide-in-from-bottom duration-200 text-stone-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-1 border-b border-stone-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-rose-950/80 border border-rose-800/60 flex items-center justify-center text-rose-400">
                  <PowerOff className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-stone-100">End Circle Early</h2>
                  <p className="text-xs text-stone-400">Close this space for all members</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEndModalOpen(false)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-950/30 border border-rose-900/40 text-xs text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <p className="leading-relaxed">
                Ending <strong>{circle.name}</strong> will immediately stop new messages for all participants. Existing message history will remain preserved for reference.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsEndModalOpen(false)}
                disabled={isActionPending}
                className="flex-1 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeEndCircle}
                disabled={isActionPending}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                {isActionPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Ending...</span>
                  </>
                ) : (
                  <span>End Circle</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
