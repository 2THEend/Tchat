import React, { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, AlertCircle, Paperclip } from 'lucide-react';
import { MAX_MESSAGE_LENGTH, validateTextMessageContent } from '../../domains/conversations/validation';
import { validateMediaFile } from '../../domains/media/validation';
import { uploadMediaFile } from '../../domains/media/mediaService';
import { 
  getConversationDraft, 
  storeConversationDraft, 
  clearConversationDraft 
} from '../../domains/conversations/conversationState';
import { MediaAttachmentPreview } from './MediaAttachmentPreview';
import { MediaCategory, TchatMediaAsset } from '../../domains/media/types';

interface MessageComposerProps {
  conversationId: string;
  onSend: (content: string, mediaAssetId?: string, mediaAsset?: TchatMediaAsset) => Promise<void>;
  isSending: boolean;
  disabled?: boolean;
}

export const MessageComposer: React.FC<MessageComposerProps> = ({
  conversationId,
  onSend,
  isSending,
  disabled = false,
}) => {
  // Restore any unsent text draft for this conversation (string-only, never files)
  const [text, setText] = useState<string>(() => getConversationDraft(conversationId));
  const [validationError, setValidationError] = useState<string | null>(null);
  
  // Update draft if conversationId changes
  useEffect(() => {
    setText(getConversationDraft(conversationId));
  }, [conversationId]);
  
  // Media Attachment State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedMediaType, setSelectedMediaType] = useState<MediaCategory | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [allowRecipientSave, setAllowRecipientSave] = useState<boolean>(true);
  const [isUploadingMedia, setIsUploadingMedia] = useState<boolean>(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      // Cap at ~120px (about 4-5 lines)
      textareaRef.current.style.height = `${Math.min(scrollHeight, 120)}px`;
    }
  }, [text]);

  // Clean up object URL on unmount or when selected file changes
  useEffect(() => {
    return () => {
      if (thumbnailUrl) {
        URL.revokeObjectURL(thumbnailUrl);
      }
    };
  }, [thumbnailUrl]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset file input value so selecting same file triggers change
    e.target.value = '';

    if (!file) return;

    const validation = validateMediaFile(file);
    if (!validation.isValid || !validation.mediaType) {
      setValidationError(validation.error || 'Invalid file format.');
      return;
    }

    setValidationError(null);
    setSelectedFile(file);
    setSelectedMediaType(validation.mediaType);

    if (validation.mediaType === 'image') {
      const url = URL.createObjectURL(file);
      setThumbnailUrl(url);
    } else {
      setThumbnailUrl(null);
    }
  };

  const handleRemoveAttachment = () => {
    if (thumbnailUrl) {
      URL.revokeObjectURL(thumbnailUrl);
      setThumbnailUrl(null);
    }
    setSelectedFile(null);
    setSelectedMediaType(null);
    setAllowRecipientSave(true);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (isSending || isUploadingMedia || disabled) return;

    // If there is text, validate text length/content
    let contentToSend = text.trim();
    if (contentToSend.length > 0) {
      const validation = validateTextMessageContent(contentToSend);
      if (!validation.isValid) {
        setValidationError(validation.error || 'Invalid message');
        return;
      }
      contentToSend = validation.cleanContent;
    }

    // Must have either text or a media file
    if (!contentToSend && !selectedFile) {
      return;
    }

    setValidationError(null);

    let uploadedAsset: TchatMediaAsset | undefined = undefined;

    // 1. If media is attached, upload file first
    if (selectedFile) {
      setIsUploadingMedia(true);
      try {
        const uploadRes = await uploadMediaFile(conversationId, selectedFile, {
          allowRecipientSave,
        });

        if (uploadRes.isSchemaPending) {
          setValidationError('Database migration pending: please apply 20260914030000_create_tchat_media_assets.sql in Supabase SQL editor.');
          setIsUploadingMedia(false);
          return;
        }

        if (uploadRes.error || !uploadRes.data) {
          setValidationError(uploadRes.error || 'Failed to upload media file.');
          setIsUploadingMedia(false);
          return;
        }

        uploadedAsset = uploadRes.data;
      } catch (err: any) {
        setValidationError(err?.message || 'Failed to upload media.');
        setIsUploadingMedia(false);
        return;
      } finally {
        setIsUploadingMedia(false);
      }
    }

    // Clear composer inputs
    setText('');
    clearConversationDraft(conversationId);
    handleRemoveAttachment();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      await onSend(contentToSend, uploadedAsset?.id, uploadedAsset);
    } catch (err: any) {
      // Restore text if send completely failed before optimistic handling
      setText(contentToSend);
      storeConversationDraft(conversationId, contentToSend);
      setValidationError(err?.message || 'Failed to send message');
    }
  };

  const remainingChars = MAX_MESSAGE_LENGTH - text.length;
  const isNearLimit = remainingChars < 100;
  const isOverLimit = remainingChars < 0;
  const hasContent = text.trim().length > 0 || selectedFile !== null;
  const canSend = hasContent && !isOverLimit && !isSending && !isUploadingMedia && !disabled;

  return (
    <footer 
      id="conversation-composer"
      className="shrink-0 pt-2 pb-3 bg-stone-950/95 border-t border-stone-800/80 backdrop-blur-md"
    >
      {/* Hidden file input supporting photos, videos, audio, documents */}
      <input
        type="file"
        ref={fileInputRef}
        id="composer-file-input"
        onChange={handleFileSelect}
        accept="image/*,video/*,audio/*,application/pdf,text/plain"
        className="hidden"
      />

      {validationError && (
        <div 
          id="composer-validation-error"
          className="mx-3 mb-2 px-3 py-1.5 rounded-lg bg-rose-950/50 border border-rose-900/60 flex items-center gap-1.5 text-xs text-rose-300"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* Selected Media Attachment Preview */}
      {selectedFile && selectedMediaType && (
        <MediaAttachmentPreview
          file={selectedFile}
          mediaType={selectedMediaType}
          thumbnailUrl={thumbnailUrl}
          allowRecipientSave={allowRecipientSave}
          onToggleAllowSave={setAllowRecipientSave}
          onRemove={handleRemoveAttachment}
          disabled={isSending || isUploadingMedia}
        />
      )}

      <div className="flex items-end gap-2 px-3">
        {/* Attachment Button */}
        <button
          id="btn-attach-media"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isSending || isUploadingMedia || selectedFile !== null}
          aria-label="Attach media"
          className="w-10 h-10 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-400 hover:text-stone-200 flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0 border border-stone-800"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        {/* Text Area Input */}
        <div className="flex-1 min-w-0 relative rounded-2xl bg-stone-900 border border-stone-800 focus-within:border-stone-700 transition-colors">
          <textarea
            ref={textareaRef}
            id="message-input-textarea"
            rows={1}
            value={text}
            onChange={(e) => {
              const val = e.target.value;
              setText(val);
              storeConversationDraft(conversationId, val);
              if (validationError) setValidationError(null);
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled || isSending || isUploadingMedia}
            placeholder={selectedFile ? 'Add a caption (optional)...' : 'Write a message...'}
            className="w-full px-3.5 py-2.5 bg-transparent text-xs sm:text-sm text-stone-100 placeholder:text-stone-500 focus:outline-none resize-none max-h-32 disabled:opacity-50"
          />

          {isNearLimit && (
            <div
              className={`absolute right-3 bottom-1.5 text-[10px] font-mono ${
                isOverLimit ? 'text-rose-400 font-bold' : 'text-stone-400'
              }`}
            >
              {remainingChars}
            </div>
          )}
        </div>

        {/* Send Button */}
        <button
          id="btn-send-message"
          type="button"
          onClick={handleSubmit}
          disabled={!canSend}
          aria-label="Send message"
          className="w-10 h-10 rounded-xl bg-stone-100 hover:bg-white text-stone-950 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer shrink-0 shadow-sm active:scale-95"
        >
          {isUploadingMedia ? (
            <div className="w-4 h-4 border-2 border-stone-950 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="w-4 h-4 translate-x-[1px]" />
          )}
        </button>
      </div>
    </footer>
  );
};
