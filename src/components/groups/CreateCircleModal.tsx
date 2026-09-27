import React, { useState } from 'react';
import { X, Sparkles, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { createCircle } from '../../domains/groups/circlesService';
import { validateCreateCircleInput } from '../../domains/groups/validation';
import { TchatCircle } from '../../domains/groups/types';

interface CreateCircleModalProps {
  groupId: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (circle: TchatCircle) => void;
}

export function CreateCircleModal({
  groupId,
  isOpen,
  onClose,
  onCreated,
}: CreateCircleModalProps) {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const validation = validateCreateCircleInput({ name, reason: reason || undefined });
    if (!validation.isValid) {
      setErrorMessage(validation.error || 'Please enter valid circle details.');
      return;
    }

    setIsSubmitting(true);
    const res = await createCircle(groupId, {
      name: name.trim(),
      reason: reason.trim() || undefined,
    });
    setIsSubmitting(false);

    if (res.error) {
      setErrorMessage(res.error);
      return;
    }

    if (res.data) {
      setName('');
      setReason('');
      onCreated(res.data);
      onClose();
    }
  };

  return (
    <div 
      id="create-circle-modal-overlay"
      className="fixed inset-0 z-50 bg-stone-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
    >
      <div 
        id="create-circle-modal-container"
        className="w-full sm:max-w-md bg-stone-900 border-t sm:border border-stone-800 rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl space-y-5 animate-in slide-in-from-bottom duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-950/80 border border-amber-700/60 flex items-center justify-center text-amber-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-stone-100">Start a Circle</h2>
              <p className="text-xs text-stone-400">Temporary side space inside this group</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Lifetime notice */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-950/60 border border-stone-800/80 text-xs text-stone-300">
          <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Circles last up to <strong>24 hours</strong> for focused, temporary discussion.</span>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-stone-300 flex items-center justify-between">
              <span>Circle Name</span>
              <span className="text-[10px] text-stone-500">{name.length}/60</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekend Plans, Tech Talk, Coffee"
              maxLength={60}
              disabled={isSubmitting}
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-sm text-stone-100 placeholder:text-stone-600 focus:outline-none focus:border-stone-600 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-stone-300 flex items-center justify-between">
              <span>Topic or Reason <span className="text-stone-500 font-normal">(optional)</span></span>
              <span className="text-[10px] text-stone-500">{reason.length}/200</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What are we talking about here?"
              maxLength={200}
              rows={2}
              disabled={isSubmitting}
              className="w-full px-3.5 py-2 rounded-xl bg-stone-950 border border-stone-800 text-sm text-stone-100 placeholder:text-stone-600 focus:outline-none focus:border-stone-600 transition-colors resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-medium text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                <span>Create Circle</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
