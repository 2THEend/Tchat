import { useState } from 'react';
import { X, Send, AlertCircle, Sparkles } from 'lucide-react';
import { TchatProfileSummary } from '../../domains/connections/types';
import { validateRequestContext } from '../../domains/connections/validation';

interface RequestModalProps {
  recipient: TchatProfileSummary;
  isOpen: boolean;
  onClose: () => void;
  onSend: (context: string) => Promise<void>;
  isSending: boolean;
}

export function RequestModal({
  recipient,
  isOpen,
  onClose,
  onSend,
  isSending,
}: RequestModalProps) {
  const [context, setContext] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);

    const val = validateRequestContext(context);
    if (!val.isValid) {
      setClientError(val.error || 'Invalid context');
      return;
    }

    try {
      await onSend(val.cleaned!);
      setContext('');
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send request.';
      setClientError(msg);
    }
  };

  const charCount = context.trim().length;

  return (
    <div 
      id="request-modal-backdrop" 
      className="fixed inset-0 z-50 bg-stone-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
    >
      <div 
        id="request-modal-dialog"
        className="w-full max-w-sm bg-stone-900 border border-stone-800 rounded-3xl p-5 space-y-4 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-stone-300" />
            <h3 className="text-sm font-semibold text-stone-100">Intentional Connection</h3>
          </div>
          <button
            id="btn-close-request-modal"
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded-2xl bg-stone-950/60 border border-stone-800/60 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
            {recipient.avatar_url ? (
              <img 
                src={recipient.avatar_url} 
                alt={recipient.display_name || recipient.username} 
                className="w-full h-full object-cover" 
              />
            ) : (
              <span className="text-sm font-semibold uppercase">{recipient.username.slice(0, 2)}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-stone-200 truncate">
              {recipient.display_name || recipient.username}
            </div>
            <div className="text-[11px] font-mono text-stone-400">
              @{recipient.username}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <label htmlFor="input-request-context" className="text-stone-300 font-medium">
                Context / Reason <span className="text-stone-400">*</span>
              </label>
              <span className={`font-mono text-[10px] ${charCount > 300 ? 'text-rose-400' : 'text-stone-400'}`}>
                {charCount}/300
              </span>
            </div>
            <textarea
              id="input-request-context"
              value={context}
              onChange={(e) => {
                setContext(e.target.value);
                if (clientError) setClientError(null);
              }}
              placeholder="Why do you want to connect? (e.g. 'Met at the design sprint yesterday', 'Following up on your photography project')"
              rows={3}
              maxLength={350}
              className="w-full px-3 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-xs text-stone-100 placeholder:text-stone-400 focus:outline-none focus:border-stone-600 resize-none transition-colors"
              autoFocus
            />
            <p className="text-[10px] text-stone-400 leading-tight">
              Tchat connections require context to ensure every relationship is intentional.
            </p>
          </div>

          {clientError && (
            <div className="flex items-center gap-1.5 p-2 rounded-xl bg-rose-950/40 border border-rose-900/60 text-[11px] text-rose-300">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{clientError}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              id="btn-cancel-request"
              type="button"
              onClick={onClose}
              disabled={isSending}
              className="flex-1 py-2 rounded-xl bg-stone-800/80 hover:bg-stone-800 text-xs font-medium text-stone-300 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              id="btn-submit-request"
              type="submit"
              disabled={isSending || charCount < 3 || charCount > 300}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSending ? 'Sending...' : 'Send Request'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
