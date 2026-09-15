import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Video, 
  Mic, 
  FileText, 
  Clock, 
  Bookmark, 
  BookmarkCheck, 
  MoreVertical, 
  Download, 
  ShieldAlert, 
  Lock, 
  Info, 
  X,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { TchatMediaAsset } from '../../domains/media/types';
import { 
  isMediaExpired, 
  canRecipientSave, 
  formatMediaTimeRemaining, 
  formatFileSize 
} from '../../domains/media/validation';
import { 
  getSignedMediaUrl, 
  saveMediaAsset 
} from '../../domains/media/mediaService';

interface MediaBubbleProps {
  media: TchatMediaAsset;
  currentUserId: string;
  conversationId: string;
  isMine: boolean;
  onMediaSaved?: (updatedAsset: TchatMediaAsset) => void;
}

export const MediaBubble: React.FC<MediaBubbleProps> = ({
  media,
  currentUserId,
  conversationId,
  isMine,
  onMediaSaved,
}) => {
  const [assetState, setAssetState] = useState<TchatMediaAsset>(media);
  const [signedUrl, setSignedUrl] = useState<string | null>(media.signed_url || null);
  const [isLoadingUrl, setIsLoadingUrl] = useState<boolean>(false);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [showDetails, setShowDetails] = useState<boolean>(false);

  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync state if prop changes
  useEffect(() => {
    setAssetState(media);
  }, [media]);

  const isExpired = isMediaExpired(assetState.expires_at, assetState.is_saved);
  const canSave = canRecipientSave(assetState, currentUserId);

  // Fetch short-lived signed URL if media is not expired and url is not yet available
  useEffect(() => {
    let isCancelled = false;

    if (isExpired) {
      setSignedUrl(null);
      return;
    }

    if (!signedUrl && assetState.storage_path) {
      setIsLoadingUrl(true);
      getSignedMediaUrl(
        assetState.storage_path, 
        assetState.id, 
        assetState.is_saved, 
        assetState.expires_at
      )
        .then((url) => {
          if (!isCancelled) {
            setSignedUrl(url);
            setIsLoadingUrl(false);
          }
        })
        .catch(() => {
          if (!isCancelled) setIsLoadingUrl(false);
        });
    }

    return () => {
      isCancelled = true;
    };
  }, [assetState.id, assetState.storage_path, assetState.is_saved, assetState.expires_at, isExpired, signedUrl]);

  // Touch handlers for Long Press (press-and-hold to open context menu)
  const handleTouchStart = () => {
    longPressTimerRef.current = setTimeout(() => {
      setIsMenuOpen(true);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleSave = async () => {
    if (isSaving || !canSave) return;

    setIsSaving(true);
    setFeedbackMessage(null);

    const res = await saveMediaAsset(assetState.id, conversationId, currentUserId);

    setIsSaving(false);
    if (res.error) {
      setFeedbackMessage(res.error);
    } else if (res.data) {
      setAssetState(res.data);
      setFeedbackMessage('Saved to conversation');
      if (onMediaSaved) onMediaSaved(res.data);
      setTimeout(() => {
        setIsMenuOpen(false);
        setFeedbackMessage(null);
      }, 1200);
    }
  };

  const handleReport = () => {
    setFeedbackMessage('Media reported for safety review');
    setTimeout(() => {
      setIsMenuOpen(false);
      setFeedbackMessage(null);
    }, 1500);
  };

  // 1. Expired Representation
  if (isExpired) {
    const getExpiredIcon = () => {
      switch (assetState.media_type) {
        case 'image': return <Camera className="w-4 h-4 text-stone-500" />;
        case 'video': return <Video className="w-4 h-4 text-stone-500" />;
        case 'audio': return <Mic className="w-4 h-4 text-stone-500" />;
        default: return <FileText className="w-4 h-4 text-stone-500" />;
      }
    };

    const getExpiredLabel = () => {
      switch (assetState.media_type) {
        case 'image': return '[Photo]';
        case 'video': return '[Video]';
        case 'audio': return '[Audio]';
        default: return '[File]';
      }
    };

    return (
      <div 
        id={`media-expired-${assetState.id}`}
        className="w-56 p-3 rounded-xl bg-stone-950/80 border border-stone-800/90 text-stone-400 flex items-center gap-2.5 select-none"
      >
        <div className="w-8 h-8 rounded-lg bg-stone-900 border border-stone-800 flex items-center justify-center shrink-0">
          {getExpiredIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-mono text-stone-300 flex items-center gap-1.5">
            <span>{getExpiredLabel()}</span>
            <span className="text-stone-500 font-sans font-normal">Expired</span>
          </div>
          <p className="text-[10px] text-stone-500 mt-0.5">24-hour limit reached</p>
        </div>
      </div>
    );
  }

  // 2. Active / Unexpired Media Representation
  const remainingText = formatMediaTimeRemaining(assetState.expires_at, assetState.is_saved);

  return (
    <div 
      id={`media-asset-${assetState.id}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="relative group rounded-xl overflow-hidden select-none max-w-full"
    >
      {/* Media Type Specific Renderers */}
      {assetState.media_type === 'image' && (
        <div className="relative rounded-xl overflow-hidden bg-stone-950 border border-stone-800">
          {isLoadingUrl && !signedUrl ? (
            <div className="w-60 h-44 flex flex-col items-center justify-center bg-stone-900 animate-pulse text-stone-500">
              <Camera className="w-6 h-6 mb-1 opacity-50" />
              <span className="text-[11px]">Loading photo...</span>
            </div>
          ) : signedUrl ? (
            <img
              src={signedUrl}
              alt={assetState.original_filename || 'Media'}
              onClick={() => setIsModalOpen(true)}
              className="max-h-64 sm:max-h-72 w-full object-cover cursor-pointer hover:opacity-95 transition-opacity"
              loading="lazy"
            />
          ) : (
            <div className="w-60 h-32 flex items-center justify-center bg-stone-900 text-stone-500 text-xs">
              Photo preview unavailable
            </div>
          )}
        </div>
      )}

      {assetState.media_type === 'video' && (
        <div className="w-64 sm:w-72 rounded-xl overflow-hidden bg-stone-950 border border-stone-800">
          {signedUrl ? (
            <video
              src={signedUrl}
              controls
              preload="metadata"
              className="w-full max-h-64 object-contain bg-black"
            />
          ) : (
            <div className="w-full h-36 flex items-center justify-center bg-stone-900 text-stone-500 text-xs">
              Loading video...
            </div>
          )}
        </div>
      )}

      {assetState.media_type === 'audio' && (
        <div className="w-64 p-2.5 rounded-xl bg-stone-900 border border-stone-800">
          <div className="flex items-center gap-2 mb-2">
            <Mic className="w-4 h-4 text-stone-400" />
            <span className="text-xs text-stone-300 truncate font-medium">
              {assetState.original_filename || 'Audio Message'}
            </span>
          </div>
          {signedUrl ? (
            <audio src={signedUrl} controls className="w-full h-8" />
          ) : (
            <div className="text-[11px] text-stone-500">Loading audio...</div>
          )}
        </div>
      )}

      {assetState.media_type === 'file' && (
        <div className="w-64 p-3 rounded-xl bg-stone-900 border border-stone-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-stone-800 flex items-center justify-center text-stone-300 shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-stone-200 font-medium truncate">
              {assetState.original_filename || 'Attachment'}
            </p>
            <p className="text-[10px] text-stone-400 mt-0.5">
              {formatFileSize(assetState.file_size_bytes)}
            </p>
          </div>
          {signedUrl && (
            <a
              href={signedUrl}
              download={assetState.original_filename || 'download'}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Download file"
              className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 transition-colors"
            >
              <Download className="w-4 h-4" />
            </a>
          )}
        </div>
      )}

      {/* Top Overlay Badge & Context Action Trigger */}
      <div className="flex items-center justify-between gap-1.5 mt-1.5 px-0.5">
        <div className="flex items-center gap-1 text-[10px]">
          {assetState.is_saved ? (
            <span 
              id={`badge-saved-${assetState.id}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-stone-800/90 text-emerald-400 border border-stone-700/60 font-medium"
            >
              <BookmarkCheck className="w-3 h-3" />
              Saved
            </span>
          ) : (
            <span 
              id={`badge-expiry-${assetState.id}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-stone-900/90 text-stone-400 border border-stone-800 font-mono text-[10px]"
            >
              <Clock className="w-2.5 h-2.5" />
              {remainingText}
            </span>
          )}

          {!assetState.allow_recipient_save && (
            <span 
              id={`badge-restricted-${assetState.id}`}
              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-stone-900 text-stone-500 border border-stone-800 text-[9px]"
              title="Sender disabled saving"
            >
              <Lock className="w-2.5 h-2.5" />
              Save restricted
            </span>
          )}
        </div>

        {/* 3-dots Context Menu Button */}
        <button
          type="button"
          id={`btn-media-menu-${assetState.id}`}
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label="Media options"
          className="p-1 rounded-md text-stone-400 hover:text-stone-200 hover:bg-stone-800/80 cursor-pointer transition-colors"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Contextual Action Modal / Dropdown */}
      {isMenuOpen && (
        <div 
          id={`media-context-menu-${assetState.id}`}
          className="absolute right-0 bottom-8 z-30 w-56 rounded-xl bg-stone-900 border border-stone-700/90 shadow-xl p-1.5 text-xs text-stone-200 backdrop-blur-md"
        >
          {feedbackMessage && (
            <div className="p-2 mb-1 rounded-lg bg-stone-800 text-stone-200 text-[11px] flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>{feedbackMessage}</span>
            </div>
          )}

          {/* Action: Save Media */}
          {canSave ? (
            <button
              type="button"
              id={`btn-save-media-${assetState.id}`}
              onClick={handleSave}
              disabled={isSaving}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-stone-800 text-stone-200 hover:text-white cursor-pointer transition-colors disabled:opacity-50"
            >
              <Bookmark className="w-4 h-4 text-emerald-400" />
              <span>{isSaving ? 'Saving...' : 'Save to Conversation'}</span>
            </button>
          ) : assetState.is_saved ? (
            <div className="px-2.5 py-1.5 text-[11px] text-emerald-400 flex items-center gap-1.5">
              <BookmarkCheck className="w-3.5 h-3.5" />
              <span>Saved in conversation</span>
            </div>
          ) : !assetState.allow_recipient_save ? (
            <div className="px-2.5 py-1.5 text-[11px] text-stone-400 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-stone-500" />
              <span>Saving disabled by sender</span>
            </div>
          ) : null}

          {/* Action: Toggle Details */}
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-stone-800 text-stone-300 hover:text-white cursor-pointer transition-colors"
          >
            <Info className="w-3.5 h-3.5 text-stone-400" />
            <span>{showDetails ? 'Hide Info' : 'Media Info'}</span>
          </button>

          {showDetails && (
            <div className="px-2.5 py-2 my-1 rounded-lg bg-stone-950 text-[10px] space-y-1 text-stone-400 border border-stone-800">
              <div>Type: <span className="text-stone-300 uppercase">{assetState.media_type}</span></div>
              <div>Size: <span className="text-stone-300">{formatFileSize(assetState.file_size_bytes)}</span></div>
              <div>Expires: <span className="text-stone-300">{assetState.is_saved ? 'Never (Saved)' : remainingText}</span></div>
            </div>
          )}

          {/* Action: Report Media */}
          <button
            type="button"
            onClick={handleReport}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-950/40 text-stone-400 hover:text-rose-300 cursor-pointer transition-colors"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Report</span>
          </button>

          <div className="border-t border-stone-800 my-1" />

          {/* Close button */}
          <button
            type="button"
            onClick={() => setIsMenuOpen(false)}
            className="w-full text-center py-1 text-[11px] text-stone-500 hover:text-stone-300 cursor-pointer"
          >
            Close
          </button>
        </div>
      )}

      {/* Full-size Image Lightbox Modal */}
      {isModalOpen && signedUrl && (
        <div 
          id="media-lightbox-modal"
          className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="p-2 rounded-full bg-stone-900/80 text-stone-200 hover:bg-stone-800 cursor-pointer"
              aria-label="Close image"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <img
            src={signedUrl}
            alt={assetState.original_filename || 'Fullscreen view'}
            className="max-h-[85vh] max-w-[95vw] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
