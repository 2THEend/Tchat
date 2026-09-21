import React from 'react';
import { GroupMessage, GroupMessageMedia } from '../../domains/groups/types';
import { GroupMediaBubble } from './GroupMediaBubble';
import { Shield, Sparkles } from 'lucide-react';

interface GroupMessageBubbleProps {
  message: GroupMessage;
  currentUserId: string;
  groupId: string;
  showSenderHeader: boolean;
  onMediaSaved?: (updatedAsset: GroupMessageMedia) => void;
}

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const GroupMessageBubble: React.FC<GroupMessageBubbleProps> = ({
  message,
  currentUserId,
  groupId,
  showSenderHeader,
  onMediaSaved,
}) => {
  const isMine = message.sender_id === currentUserId;
  const timeFormatted = formatTime(message.created_at);
  const isSystem = message.message_type === 'system';

  // 1. System messages (e.g. membership updates, lifecycle events)
  if (isSystem) {
    return (
      <div 
        id={`group-system-msg-${message.id}`}
        className="flex justify-center my-2 select-none"
      >
        <div className="px-3 py-1 rounded-full bg-stone-900/60 border border-stone-800/60 text-[11px] text-stone-500 max-w-sm text-center leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  const senderName = message.sender?.display_name || message.sender?.username || 'Member';
  const senderRole = message.sender?.role || 'member';
  const initial = senderName.charAt(0).toUpperCase();

  return (
    <div
      id={`group-message-${message.id}`}
      className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} ${
        showSenderHeader ? 'mt-3' : 'mt-1'
      }`}
    >
      {/* Sender Header for Other Members */}
      {!isMine && showSenderHeader && (
        <div className="flex items-center gap-2 mb-1 pl-1">
          {/* Avatar or Initial */}
          <div className="w-5 h-5 rounded-full bg-stone-800 border border-stone-700/60 flex items-center justify-center overflow-hidden shrink-0">
            {message.sender?.avatar_url ? (
              <img
                src={message.sender.avatar_url}
                alt={senderName}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-[10px] font-medium text-stone-300">
                {initial}
              </span>
            )}
          </div>

          {/* Display Name */}
          <span className="text-xs font-medium text-stone-300">
            {senderName}
          </span>

          {/* Subtle Role Indicator (Admin / Mod / Special) */}
          {senderRole === 'admin' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
              <Shield className="w-2.5 h-2.5" />
              <span>Admin</span>
            </span>
          )}
          {senderRole === 'mod' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-medium bg-blue-950/60 text-blue-300 border border-blue-800/40">
              <span>Mod</span>
            </span>
          )}
          {senderRole === 'special' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-medium bg-amber-950/60 text-amber-300 border border-amber-800/40">
              <Sparkles className="w-2.5 h-2.5" />
              <span>Special</span>
            </span>
          )}
        </div>
      )}

      {/* Message Content Container */}
      <div className={`max-w-[85%] sm:max-w-[75%] flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
        {/* Ephemeral Media Attachment */}
        {message.media && (
          <div className="mb-1">
            <GroupMediaBubble
              media={message.media}
              currentUserId={currentUserId}
              groupId={groupId}
              isMine={isMine}
              onMediaSaved={onMediaSaved}
            />
          </div>
        )}

        {/* Text Content */}
        {message.content && message.content.trim().length > 0 && (
          <div
            className={`px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed break-words ${
              isMine
                ? 'bg-stone-800 text-stone-100 border border-stone-700/60 rounded-br-sm'
                : 'bg-stone-900/90 text-stone-200 border border-stone-800/80 rounded-bl-sm'
            }`}
          >
            {message.content}
          </div>
        )}

        {/* Timestamp */}
        <div className="flex items-center gap-1 mt-0.5 px-1">
          <span className="text-[10px] text-stone-500 select-none">
            {timeFormatted}
          </span>
        </div>
      </div>
    </div>
  );
};
