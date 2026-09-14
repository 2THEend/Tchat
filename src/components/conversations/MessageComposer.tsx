import React, { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, AlertCircle } from 'lucide-react';
import { MAX_MESSAGE_LENGTH, validateTextMessageContent } from '../../domains/conversations/validation';

interface MessageComposerProps {
  onSend: (content: string) => Promise<void>;
  isSending: boolean;
  disabled?: boolean;
}

export const MessageComposer: React.FC<MessageComposerProps> = ({
  onSend,
  isSending,
  disabled = false,
}) => {
  const [text, setText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      // Cap at ~120px (about 4-5 lines)
      textareaRef.current.style.height = `${Math.min(scrollHeight, 120)}px`;
    }
  }, [text]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (isSending || disabled) return;

    const validation = validateTextMessageContent(text);
    if (!validation.isValid) {
      setValidationError(validation.error || 'Invalid message');
      return;
    }

    setValidationError(null);
    const contentToSend = validation.cleanContent;
    setText('');

    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      await onSend(contentToSend);
    } catch (err: any) {
      // Restore text if send completely failed before optimistic handling
      setText(contentToSend);
      setValidationError(err?.message || 'Failed to send message');
    }
  };

  const remainingChars = MAX_MESSAGE_LENGTH - text.length;
  const isNearLimit = remainingChars < 100;
  const isOverLimit = remainingChars < 0;
  const canSend = text.trim().length > 0 && !isOverLimit && !isSending && !disabled;

  return (
    <footer 
      id="conversation-composer"
      className="shrink-0 p-3 bg-stone-950/95 border-t border-stone-800/80 backdrop-blur-md"
    >
      {validationError && (
        <div className="mb-2 px-3 py-1.5 rounded-lg bg-rose-950/50 border border-rose-900/60 flex items-center gap-1.5 text-xs text-rose-300">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0 relative rounded-2xl bg-stone-900 border border-stone-800 focus-within:border-stone-700 transition-colors">
          <textarea
            ref={textareaRef}
            id="message-input-textarea"
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (validationError) setValidationError(null);
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled || isSending}
            placeholder="Write a message..."
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

        <button
          id="btn-send-message"
          type="button"
          onClick={handleSubmit}
          disabled={!canSend}
          aria-label="Send message"
          className="w-10 h-10 rounded-xl bg-stone-100 hover:bg-white text-stone-950 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer shrink-0 shadow-sm active:scale-95"
        >
          <Send className="w-4 h-4 translate-x-[1px]" />
        </button>
      </div>
    </footer>
  );
};
