import React, { useState } from 'react';
import { Phone, X, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import { 
  CallPresetReason, 
  CALL_PRESET_LABELS, 
  DEFAULT_IMMEDIATE_CALL_EXPIRATION_SECONDS 
} from '../../../domains/calls/types';
import { validateCallReason } from '../../../domains/calls/validation';
import { createCallRequest } from '../../../domains/calls/callsService';

interface CallRequestModalProps {
  conversationId: string;
  partnerName: string;
  isOpen: boolean;
  onClose: () => void;
  onCallRequested: () => void;
}

export const CallRequestModal: React.FC<CallRequestModalProps> = ({
  conversationId,
  partnerName,
  isOpen,
  onClose,
  onCallRequested,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<CallPresetReason | null>('quick_sync');
  const [customReason, setCustomReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const validation = validateCallReason(selectedPreset, customReason);
    if (!validation.isValid) {
      setFormError(validation.error || 'A valid reason is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await createCallRequest({
        conversationId,
        presetReason: validation.cleanPreset,
        customReason: validation.cleanCustom,
        expiresInSeconds: DEFAULT_IMMEDIATE_CALL_EXPIRATION_SECONDS,
        mode: 'immediate',
      });

      if (res.error) {
        setFormError(res.error);
      } else {
        onCallRequested();
        onClose();
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create call request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const presetEntries: Array<{ key: CallPresetReason; label: string }> = [
    { key: 'quick_sync', label: CALL_PRESET_LABELS.quick_sync },
    { key: 'question', label: CALL_PRESET_LABELS.question },
    { key: 'catch_up', label: CALL_PRESET_LABELS.catch_up },
    { key: 'planning', label: CALL_PRESET_LABELS.planning },
    { key: 'urgent', label: CALL_PRESET_LABELS.urgent },
  ];

  return (
    <div
      id="modal-call-request-backdrop"
      className="fixed inset-0 z-50 bg-stone-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="modal-call-request-content"
        className="w-full max-w-md bg-stone-900 border-t sm:border border-stone-800 rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <Phone className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-stone-100">
                Request a Call
              </h2>
              <p className="text-[11px] text-stone-400">
                With {partnerName} · Requires acceptance
              </p>
            </div>
          </div>

          <button
            id="btn-close-call-modal"
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {formError && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/40 text-xs text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{formError}</span>
            </div>
          )}

          {/* Preset Reasons */}
          <div>
            <label className="block text-xs font-medium text-stone-300 mb-2">
              Call Context / Reason <span className="text-emerald-400">*</span>
            </label>
            <div className="grid grid-cols-1 gap-2">
              {presetEntries.map(({ key, label }) => {
                const isSelected = selectedPreset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedPreset(isSelected ? null : key)}
                    className={`px-3 py-2.5 rounded-xl border text-left text-xs font-medium transition-all flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-950/40 border-emerald-600/70 text-emerald-200'
                        : 'bg-stone-900 border-stone-800 text-stone-300 hover:border-stone-700'
                    }`}
                  >
                    <span>{label}</span>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional / Custom Note */}
          <div>
            <label className="block text-xs font-medium text-stone-300 mb-1.5">
              Custom Note {selectedPreset ? '(optional)' : '(required if no preset)'}
            </label>
            <textarea
              id="input-call-custom-reason"
              rows={2}
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="e.g., Quick check-in about the project proposal..."
              maxLength={300}
              className="w-full px-3 py-2 bg-stone-950 border border-stone-800 rounded-xl text-xs text-stone-200 placeholder-stone-500 focus:outline-none focus:border-emerald-600 transition-colors resize-none"
            />
            <div className="flex items-center justify-between mt-1 text-[11px] text-stone-500 font-mono">
              <span>Reason is required before requesting</span>
              <span>{customReason.length}/300</span>
            </div>
          </div>

          {/* Principle explanation */}
          <div className="p-3 rounded-xl bg-stone-950 border border-stone-800/80 text-[11px] text-stone-400 space-y-1">
            <div className="flex items-center gap-1.5 text-stone-300 font-medium">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Immediate Call Agreement</span>
            </div>
            <p>
              Calls do not ring or connect automatically. {partnerName} must explicitly accept this request within 2 minutes.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center gap-2">
            <button
              id="btn-submit-call-request"
              type="submit"
              disabled={isSubmitting || (!selectedPreset && customReason.trim().length < 2)}
              className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-stone-950 font-semibold text-xs transition-colors disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Phone className="w-4 h-4" />
              {isSubmitting ? 'Requesting...' : 'Send Call Request'}
            </button>
            <button
              id="btn-cancel-call-modal"
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 font-medium text-xs transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
