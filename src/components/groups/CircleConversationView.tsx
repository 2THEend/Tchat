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
  Lock
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

  // Leave Circle
  const handleLeaveCircle = async () => {
    if (!window.confirm('Leave this circle? You can rejoin anytime while it remains active.')) return;

    setIsActionPending(true);
    setActionError(null);
    const res = await leaveCircle(circle.id);
    setIsActionPending(false);

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

  // End Circle
  const handleEndCircle = async () => {
    if (!window.confirm('End this circle early? No new messages can be sent.')) return;

    setIsActionPending(true);
    setActionError(null);
    const res = await endCircle(circle.id);
    setIsActionPending(false);

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
      {/* 1. Header */}
      <header className="shrink-0 bg-stone-950/95 backdrop-blur-md px-4 py-3 border-b border-stone-900 flex items-center justify-between z-20">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToGroup}
            className="p-2 -ml-1.5 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
            title="Back to Group"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="w-9 h-9 rounded-xl bg-amber-950/80 border border-amber-700/60 flex items-center justify-center shrink-0 text-amber-400">
            <Sparkles className="w-4 h-4" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-stone-100 truncate">
                {circle.name}
              </h1>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0 ${
                isExpired 
                  ? 'bg-stone-800 text-stone-400 border border-stone-700' 
                  : 'bg-amber-950/60 text-amber-300 border border-amber-800/60'
              }`}>
                <Clock className="w-2.5 h-2.5" />
                <span>{formatRemaining(circle.expires_at)}</span>
              </span>
            </div>
            <p className="text-[11px] text-stone-400 truncate">
              Inside <span className="text-stone-300 font-medium">{parentGroup.name}</span>
              {circle.reason ? ` · ${circle.reason}` : ''}
            </p>
          </div>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Members Button */}
          <button
            type="button"
            onClick={() => setIsMembersModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 text-xs font-medium border border-stone-800 transition-colors cursor-pointer"
            title="View Circle Members"
          >
            <Users className="w-3.5 h-3.5 text-stone-400" />
            <span>{circle.member_count}</span>
          </button>

          {/* Join / Leave / End */}
          {!circle.is_member && !isExpired && (
            <button
              type="button"
              onClick={handleJoinCircle}
              disabled={isActionPending}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-semibold transition-colors cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Join</span>
            </button>
          )}

          {circle.is_member && !isExpired && (
            <button
              type="button"
              onClick={handleLeaveCircle}
              disabled={isActionPending}
              className="p-2 rounded-xl hover:bg-stone-900 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
              title="Leave Circle"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}

          {canEndCircle && (
            <button
              type="button"
              onClick={handleEndCircle}
              disabled={isActionPending}
              className="p-2 rounded-xl hover:bg-rose-950/60 text-stone-400 hover:text-rose-300 transition-colors cursor-pointer"
              title="End Circle Early"
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
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
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

                <div 
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                    isMe 
                      ? 'bg-amber-600 text-stone-950 rounded-br-sm font-medium' 
                      : 'bg-stone-900 border border-stone-800 text-stone-200 rounded-bl-sm'
                  }`}
                >
                  {msg.media ? (
                    <div className="space-y-1">
                      <GroupMediaBubble 
                        media={msg.media} 
                        groupId={parentGroup.id}
                        isMine={isMe} 
                        currentUserId={currentUserId}
                      />
                      {msg.content && msg.content !== msg.media.original_filename && (
                        <p className="pt-1">{msg.content}</p>
                      )}
                    </div>
                  ) : (
                    <p className="break-words">{msg.content}</p>
                  )}

                  <span className={`block text-[9px] mt-1 ${isMe ? 'text-stone-900/70' : 'text-stone-500'} text-right`}>
                    {timeStr}
                  </span>
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
            accept="image/*,video/*,audio/*"
            className="hidden" 
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingMedia || isSending}
            className="p-2.5 rounded-xl bg-stone-900 border border-stone-800 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer disabled:opacity-50"
            title="Attach media"
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
            disabled={isSending}
            className="flex-1 px-3.5 py-2.5 rounded-xl bg-stone-900 border border-stone-800 text-xs text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-stone-700 transition-colors"
          />

          <button
            type="submit"
            disabled={!inputText.trim() || isSending}
            className="p-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 disabled:opacity-40 transition-colors cursor-pointer"
            title="Send Message"
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      ) : (
        <div className="shrink-0 p-3 bg-stone-900/60 border-t border-stone-800/80 text-center text-xs text-stone-500">
          Interactions are closed for this circle.
        </div>
      )}

      {/* Members Modal */}
      <CircleMembersModal
        circleId={circle.id}
        circleName={circle.name}
        isOpen={isMembersModalOpen}
        onClose={() => setIsMembersModalOpen(false)}
      />
    </div>
  );
}
