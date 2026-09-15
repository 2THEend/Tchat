import React, { useState, useEffect } from 'react';
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
  Maximize2,
  RotateCw
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
  const [isHorizontalRotated, setIsHorizontalRotated] = useState<boolean>(false);

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
      className="relative group rounded-xl select-none max-w-full"
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
            <div className="relative group/img">
              <img
                src={signedUrl}
                alt={assetState.original_filename || 'Media'}
                onClick={() => setIsModalOpen(true)}
                className="max-h-64 sm:max-h-72 w-full object-cover cursor-pointer hover:opacity-95 transition-opacity"
                loading="lazy"
              />
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-stone-900/80 hover:bg-stone-800 text-stone-200 backdrop-blur-sm opacity-80 group-hover/img:opacity-100 transition-opacity cursor-pointer"
                title="Open full view"
                aria-label="Open photo in full view"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="w-60 h-32 flex items-center justify-center bg-stone-900 text-stone-500 text-xs">
              Photo preview unavailable
            </div>
          )}
        </div>
      )}

      {assetState.media_type === 'video' && (
        <div className="w-64 sm:w-72 rounded-xl overflow-hidden bg-stone-950 border border-stone-800 relative group/video">
          {signedUrl ? (
            <div className="relative">
              <video
                src={signedUrl}
                controls
                playsInline
                preload="metadata"
                className="w-full max-h-64 object-contain bg-black"
              />
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-stone-900/80 hover:bg-stone-800 text-stone-200 backdrop-blur-sm opacity-80 group-hover/video:opacity-100 transition-opacity cursor-pointer"
                title="Open full view"
                aria-label="Open video in full view"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
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

      {/* Meta Bar & Options Trigger */}
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
          onClick={() => setIsMenuOpen(true)}
          aria-label="Media options"
          className="p-1 rounded-md text-stone-400 hover:text-stone-200 hover:bg-stone-800/80 cursor-pointer transition-colors"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Contextual Action Sheet Modal (Rendered with fixed overlay so it never clips or overlaps media) */}
      {isMenuOpen && (
        <div 
          id={`media-action-sheet-${assetState.id}`}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsMenuOpen(false)}
        >
          <div 
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl bg-stone-900 border-t sm:border border-stone-800 p-5 text-stone-200 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grabber on mobile */}
            <div className="w-10 h-1 rounded-full bg-stone-700 mx-auto -mt-1 sm:hidden" />

            {/* Header with media metadata */}
            <div className="flex items-center justify-between pb-3 border-b border-stone-800/80">
              <div className="min-w-0 pr-2">
                <div className="text-sm font-semibold text-stone-100 truncate">
                  {assetState.original_filename || (assetState.media_type === 'video' ? 'Video' : 'Photo')}
                </div>
                <div className="text-[11px] text-stone-400 font-mono mt-0.5">
                  {formatFileSize(assetState.file_size_bytes)} • {assetState.media_type.toUpperCase()}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs">
                  {assetState.is_saved ? (
                    <span className="text-emerald-400 font-medium flex items-center gap-1">
                      <BookmarkCheck className="w-3.5 h-3.5" /> Saved
                    </span>
                  ) : (
                    <span className="text-stone-400 font-mono flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {remainingText}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {feedbackMessage && (
              <div className="p-2.5 rounded-xl bg-stone-800 text-stone-200 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{feedbackMessage}</span>
              </div>
            )}

            {/* Actions List */}
            <div className="space-y-2">
              {/* Full View Button */}
              {(assetState.media_type === 'image' || assetState.media_type === 'video') && signedUrl && (
                <button
                  type="button"
                  id={`btn-fullview-${assetState.id}`}
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-stone-800/80 hover:bg-stone-800 text-stone-100 text-xs font-medium cursor-pointer transition-colors"
                >
                  <Maximize2 className="w-4 h-4 text-stone-300" />
                  <span>Open Full View</span>
                </button>
              )}

              {/* Save Media Action */}
              {canSave ? (
                <button
                  type="button"
                  id={`btn-save-media-${assetState.id}`}
                  onClick={handleSave}
                  disabled={isSaving}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 hover:bg-emerald-900/40 text-emerald-300 text-xs font-medium cursor-pointer transition-colors disabled:opacity-50"
                >
                  <Bookmark className="w-4 h-4 text-emerald-400" />
                  <span>{isSaving ? 'Saving...' : 'Save to Conversation'}</span>
                </button>
              ) : assetState.is_saved ? (
                <div className="px-3.5 py-2.5 rounded-xl bg-stone-800/40 text-xs text-emerald-400 flex items-center gap-2">
                  <BookmarkCheck className="w-4 h-4" />
                  <span>Saved permanently in this conversation</span>
                </div>
              ) : !assetState.allow_recipient_save ? (
                <div className="px-3.5 py-2.5 rounded-xl bg-stone-800/40 text-xs text-stone-400 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-stone-500" />
                  <span>Saving restricted by sender</span>
                </div>
              ) : null}

              {/* Report Media Action */}
              <button
                type="button"
                onClick={handleReport}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-rose-950/30 text-stone-400 hover:text-rose-300 text-xs cursor-pointer transition-colors"
              >
                <ShieldAlert className="w-4 h-4 text-stone-500" />
                <span>Report Media</span>
              </button>
            </div>

            {/* Cancel Button */}
            <button
              type="button"
              onClick={() => setIsMenuOpen(false)}
              className="w-full py-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Full-view Modal (Supports Images & Videos with Horizontal Full View toggle) */}
      {isModalOpen && signedUrl && (
        <div 
          id="media-lightbox-modal"
          className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-between p-4 selection:bg-stone-800"
          onClick={() => {
            setIsModalOpen(false);
            setIsHorizontalRotated(false);
          }}
        >
          {/* Top Control Bar */}
          <div 
            className="w-full max-w-4xl flex items-center justify-between z-10 px-2 py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-stone-300 text-xs">
              <span className="font-medium truncate max-w-[180px] sm:max-w-xs">
                {assetState.original_filename || (assetState.media_type === 'video' ? 'Video' : 'Photo')}
              </span>
              <span className="text-stone-500">•</span>
              <span className="text-stone-400 font-mono text-[11px]">
                {assetState.is_saved ? 'Saved' : remainingText}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Horizontal View Toggle Button */}
              <button
                type="button"
                id="btn-toggle-horizontal-view"
                onClick={() => setIsHorizontalRotated(!isHorizontalRotated)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                  isHorizontalRotated 
                    ? 'bg-emerald-600 text-white' 
                    : 'bg-stone-800/80 text-stone-300 hover:bg-stone-700'
                }`}
                title="Toggle horizontal full view"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>{isHorizontalRotated ? 'Portrait' : 'Horizontal'}</span>
              </button>

              {/* Close Button */}
              <button
                type="button"
                id="btn-close-fullview"
                onClick={() => {
                  setIsModalOpen(false);
                  setIsHorizontalRotated(false);
                }}
                className="p-2 rounded-full bg-stone-800/80 text-stone-200 hover:bg-stone-700 cursor-pointer transition-colors"
                aria-label="Close full view"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Media Content Area */}
          <div 
            className="flex-1 w-full flex items-center justify-center relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div 
              className={`transition-transform duration-300 ease-in-out flex items-center justify-center max-w-full max-h-full ${
                isHorizontalRotated ? 'rotate-90 w-[80vh] h-[90vw]' : 'w-full h-full'
              }`}
            >
              {assetState.media_type === 'video' ? (
                <video
                  src={signedUrl}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[82vh] max-w-[96vw] landscape:max-h-[90vh] object-contain rounded-lg shadow-2xl bg-black"
                />
              ) : (
                <img
                  src={signedUrl}
                  alt={assetState.original_filename || 'Fullscreen view'}
                  className="max-h-[82vh] max-w-[96vw] landscape:max-h-[90vh] object-contain rounded-lg shadow-2xl"
                />
              )}
            </div>
          </div>

          {/* Bottom Hint */}
          <div className="py-1 text-[11px] text-stone-500 text-center select-none">
            {isHorizontalRotated 
              ? 'Viewing in horizontal mode • Tap Portrait to reset' 
              : 'Tap Horizontal or rotate device to landscape'}
          </div>
        </div>
      )}
    </div>
  );
};

