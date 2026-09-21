import React, { useState, useRef, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import { Send, Paperclip, AlertCircle, X, Lock } from 'lucide-react';
import { GroupLifecycleStatus, GroupMessageMedia } from '../../domains/groups/types';
import { MediaAttachmentPreview } from '../conversations/MediaAttachmentPreview';
import { validateMediaFile } from '../../domains/media/validation';

interface GroupMessageComposerProps {
  groupId: string;
  isGroupActive: boolean;
  lifecycleStatus: GroupLifecycleStatus;
  onSendMessage: (content: string, mediaAssetId?: string) => Promise<{ error: string | null }>;
  onUploadMedia: (file: File, options?: { allowRecipientSave?: boolean }) => Promise<{ data: GroupMessageMedia | null; error: string | null }>;
}

const MAX_MESSAGE_LENGTH = 2000;

export const GroupMessageComposer: React.FC<GroupMessageComposerProps> = ({
  groupId,
  isGroupActive,
  lifecycleStatus,
  onSendMessage,
  onUploadMedia,
}) => {
  const [content, setContent] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [allowRecipientSave, setAllowRecipientSave] = useState<boolean>(true);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 120);
      textareaRef.current.style.height = `${Math.max(newHeight, 38)}px`;
    }
  }, [content]);

  // Clean up object URL
  useEffect(() => {
    return () => {
      if (filePreviewUrl) {
        URL.revokeObjectURL(filePreviewUrl);
      }
    };
  }, [filePreviewUrl]);

  // If group is no longer active, display calm disabled banner
  if (!isGroupActive) {
    const isReadOnly = lifecycleStatus === 'read_only';
    return (
      <div 
        id="group-composer-disabled"
        className="p-4 bg-stone-900/90 border-t border-stone-800/80 flex items-center gap-3 text-stone-400 select-none"
      >
        <div className="w-8 h-8 rounded-xl bg-stone-950 border border-stone-800 flex items-center justify-center shrink-0">
          <Lock className="w-4 h-4 text-stone-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-stone-300">
            {isReadOnly ? 'Group in Read-Only Mode' : 'Group Closed'}
          </p>
          <p className="text-[11px] text-stone-500 leading-relaxed">
            {isReadOnly 
              ? 'This group has entered its closing grace window. Messages remain visible for review, but new messages cannot be sent.'
              : 'This group has ended its active lifetime. New messages cannot be sent.'}
          </p>
        </div>
      </div>
    );
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate media file
    const validation = validateMediaFile(file);
    if (!validation.isValid) {
      setErrorMessage(validation.error || 'Invalid media file');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
    }

    setSelectedFile(file);
    if (validation.mediaType === 'image') {
      setFilePreviewUrl(URL.createObjectURL(file));
    } else {
      setFilePreviewUrl(null);
    }
  };

  const handleRemoveAttachment = () => {
    setSelectedFile(null);
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSend = async () => {
    if (isSending) return;

    const trimmed = content.trim();
    if (!trimmed && !selectedFile) return;

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      setErrorMessage(`Message exceeds ${MAX_MESSAGE_LENGTH} characters.`);
      return;
    }

    setIsSending(true);
    setErrorMessage(null);

    try {
      let mediaAssetId: string | undefined = undefined;

      // 1. If media attachment present, upload first
      if (selectedFile) {
        const uploadRes = await onUploadMedia(selectedFile, { allowRecipientSave });
        if (uploadRes.error || !uploadRes.data) {
          setErrorMessage(uploadRes.error || 'Failed to upload media attachment.');
          setIsSending(false);
          return;
        }
        mediaAssetId = uploadRes.data.id;
      }

      // 2. Dispatch group message via authoritative RPC
      const sendRes = await onSendMessage(trimmed, mediaAssetId);

      if (sendRes.error) {
        setErrorMessage(sendRes.error);
        setIsSending(false);
        return;
      }

      // 3. Clear state on success
      setContent('');
      handleRemoveAttachment();
      if (textareaRef.current) {
        textareaRef.current.style.height = '38px';
        textareaRef.current.focus();
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div 
      id="group-message-composer"
      className="bg-stone-900/90 border-t border-stone-800/80 p-3 relative"
    >
      {/* Non-blocking Error Banner */}
      {errorMessage && (
        <div 
          id="group-composer-error"
          className="mb-2 p-2 rounded-xl bg-rose-950/40 border border-rose-900/60 flex items-center justify-between text-rose-300 text-xs animate-in fade-in"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="truncate">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1 text-rose-400 hover:text-rose-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Attachment Preview */}
      {selectedFile && (
        <div className="mb-2">
          <MediaAttachmentPreview
            file={selectedFile}
            mediaType={validateMediaFile(selectedFile).mediaType || 'image'}
            thumbnailUrl={filePreviewUrl}
            allowRecipientSave={allowRecipientSave}
            onToggleAllowSave={setAllowRecipientSave}
            onRemove={handleRemoveAttachment}
            disabled={isSending}
          />
        </div>
      )}

      {/* Input Row */}
      <div className="flex items-end gap-2">
        {/* Attachment Button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,audio/mpeg,audio/wav,application/pdf"
          onChange={handleFileChange}
          className="hidden"
          id="group-media-file-input"
          disabled={isSending}
        />
        <button
          type="button"
          id="btn-group-attach-media"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending}
          className="p-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-400 hover:text-stone-200 hover:border-stone-700 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          title="Attach ephemeral photo or media (24h lifespan)"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        {/* Textarea */}
        <div className="flex-1 min-w-0 relative">
          <textarea
            ref={textareaRef}
            id="group-message-input"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send an intentional message..."
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            disabled={isSending}
            className="w-full resize-none px-3.5 py-2 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 placeholder-stone-500 text-xs sm:text-sm focus:outline-none focus:border-stone-600 transition-colors leading-relaxed disabled:opacity-50"
          />
        </div>

        {/* Send Button */}
        <button
          type="button"
          id="btn-group-send-message"
          onClick={handleSend}
          disabled={isSending || (!content.trim() && !selectedFile)}
          className={`p-2.5 rounded-xl border transition-colors shrink-0 cursor-pointer ${
            content.trim() || selectedFile
              ? 'bg-stone-100 text-stone-900 border-stone-100 hover:bg-white'
              : 'bg-stone-950 text-stone-600 border-stone-800/80 cursor-not-allowed'
          } disabled:opacity-50`}
          title="Send message"
        >
          {isSending ? (
            <div className="w-4 h-4 border-2 border-stone-900 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
};
