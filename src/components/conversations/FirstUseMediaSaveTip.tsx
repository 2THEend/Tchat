import React, { useState, useEffect } from 'react';
import { Bookmark, X } from 'lucide-react';

const STORAGE_KEY = 'tchat_media_save_tip_seen';

export const FirstUseMediaSaveTip: React.FC = () => {
  const [isVisible, setIsVisible] = useState<boolean>(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        setIsVisible(true);
      }
    } catch {
      // Ignore localStorage errors in sandbox
    }
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // Ignore
    }
  };

  if (!isVisible) return null;

  return (
    <div 
      id="media-save-education-tip"
      className="mx-4 my-2 p-2.5 rounded-xl bg-stone-900 border border-stone-800 flex items-start gap-2.5 text-xs text-stone-300 shadow-sm animate-in fade-in slide-in-from-top-2"
    >
      <div className="w-6 h-6 rounded-lg bg-stone-800 flex items-center justify-center text-stone-400 shrink-0 mt-0.5">
        <Bookmark className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="leading-snug text-stone-200 font-medium">
          Ephemeral Media
        </p>
        <p className="text-[11px] text-stone-400 mt-0.5 leading-relaxed">
          Media in conversations expires after 24 hours. Press and hold (or tap menu) on any media to save it permanently.
        </p>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss tip"
        className="text-stone-500 hover:text-stone-300 p-1 cursor-pointer transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
