import React from 'react';
import { 
  X, 
  Camera, 
  Video, 
  Mic, 
  FileText, 
  Lock, 
  Unlock 
} from 'lucide-react';
import { MediaCategory } from '../../domains/media/types';
import { formatFileSize } from '../../domains/media/validation';

interface MediaAttachmentPreviewProps {
  file: File;
  mediaType: MediaCategory;
  thumbnailUrl?: string | null;
  allowRecipientSave: boolean;
  onToggleAllowSave: (allowed: boolean) => void;
  onRemove: () => void;
  disabled?: boolean;
}

export const MediaAttachmentPreview: React.FC<MediaAttachmentPreviewProps> = ({
  file,
  mediaType,
  thumbnailUrl,
  allowRecipientSave,
  onToggleAllowSave,
  onRemove,
  disabled = false,
}) => {
  const renderIcon = () => {
    switch (mediaType) {
      case 'image': return <Camera className="w-5 h-5 text-stone-400" />;
      case 'video': return <Video className="w-5 h-5 text-stone-400" />;
      case 'audio': return <Mic className="w-5 h-5 text-stone-400" />;
      default: return <FileText className="w-5 h-5 text-stone-400" />;
    }
  };

  return (
    <div 
      id="media-attachment-preview"
      className="p-2.5 mx-3 mb-2 rounded-xl bg-stone-900 border border-stone-800 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2"
    >
      {/* Thumbnail or Category Icon */}
      <div className="w-12 h-12 rounded-lg bg-stone-950 border border-stone-800 overflow-hidden flex items-center justify-center shrink-0">
        {thumbnailUrl && mediaType === 'image' ? (
          <img 
            src={thumbnailUrl} 
            alt="Preview" 
            className="w-full h-full object-cover" 
          />
        ) : (
          renderIcon()
        )}
      </div>

      {/* Info & Options */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-stone-200 font-medium truncate">
          {file.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-stone-400">
            {formatFileSize(file.size)}
          </span>
          <span className="text-[10px] text-stone-600">•</span>
          <span className="text-[10px] text-stone-400 uppercase">
            {mediaType}
          </span>
        </div>

        {/* Sender Option: Allow Recipient to Save */}
        <button
          type="button"
          id="btn-toggle-allow-save"
          disabled={disabled}
          onClick={() => onToggleAllowSave(!allowRecipientSave)}
          className={`mt-1.5 inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
            allowRecipientSave
              ? 'bg-stone-800/80 text-stone-300 border-stone-700/60 hover:bg-stone-800'
              : 'bg-amber-950/40 text-amber-300 border-amber-800/50 hover:bg-amber-950/60'
          }`}
          title="Toggle whether recipient is allowed to permanently save this media"
        >
          {allowRecipientSave ? (
            <>
              <Unlock className="w-3 h-3 text-stone-400" />
              <span>Recipient can save</span>
            </>
          ) : (
            <>
              <Lock className="w-3 h-3 text-amber-400" />
              <span>Save restricted</span>
            </>
          )}
        </button>
      </div>

      {/* Remove Button */}
      <button
        type="button"
        id="btn-remove-attachment"
        disabled={disabled}
        onClick={onRemove}
        aria-label="Remove attachment"
        className="p-1.5 rounded-lg text-stone-500 hover:text-stone-300 hover:bg-stone-800 cursor-pointer transition-colors disabled:opacity-40"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
