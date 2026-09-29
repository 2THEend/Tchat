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
  Lock, 
  Info, 
  X,
  Maximize2,
  RotateCw
} from 'lucide-react';
import { GroupMessageMedia } from '../../domains/groups/types';
import { 
  isMediaExpired, 
  formatMediaTimeRemaining, 
  formatFileSize 
} from '../../domains/media/validation';
import { getSignedMediaUrl } from '../../domains/media/mediaService';
import { saveGroupMediaAsset } from '../../domains/groups/groupsService';

interface GroupMediaBubbleProps {
  media: GroupMessageMedia;
  currentUserId: string;
  groupId: string;
  isMine: boolean;
  context?: 'group' | 'circle';
  onMediaSaved?: (updatedAsset: GroupMessageMedia) => void;
}

export const GroupMediaBubble: React.FC<GroupMediaBubbleProps> = ({
  media,
  currentUserId,
  groupId,
  isMine,
  context = 'group',
  onMediaSaved,
}) => {
  const [assetState, setAssetState] = useState<GroupMessageMedia>(media);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoadingUrl, setIsLoadingUrl] = useState<boolean>(false);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isRotated, setIsRotated] = useState<boolean>(false);

  useEffect(() => {
    setAssetState(media);
  }, [media]);

  const isExpired = isMediaExpired(assetState.expires_at, assetState.is_saved);
  const canSave = assetState.allow_recipient_save && !assetState.is_saved;

  const isCircle = context === 'circle';
  const saveLabel = isCircle ? 'Save Media' : 'Save to group';
  const infoTitle = isCircle ? 'Ephemeral Circle Media' : 'Ephemeral Group Media';
  const savedToast = isCircle ? 'Saved to circle' : 'Saved to group';

  // Retrieve temporary signed URL from Supabase Storage
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

    const res = await saveGroupMediaAsset(assetState.id, groupId, currentUserId);

    setIsSaving(false);
    if (res.error) {
      setFeedbackMessage(res.error);
    } else if (res.data) {
      setAssetState(res.data);
      setFeedbackMessage(savedToast);
      if (onMediaSaved) onMediaSaved(res.data);
      setTimeout(() => {
        setIsMenuOpen(false);
        setFeedbackMessage(null);
      }, 1200);
    }
  };

  // 1. Expired state representation
  if (isExpired) {
    return (
      <div 
        id={`group-media-expired-${assetState.id}`}
        className="px-3.5 py-3 rounded-2xl bg-stone-900/60 border border-stone-800/80 flex items-center gap-3 text-stone-500 max-w-sm select-none"
      >
        <div className="w-8 h-8 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-center shrink-0">
          <Clock className="w-4 h-4 text-stone-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-stone-400">
            [Expired Media]
          </p>
          <p className="text-[11px] text-stone-500 truncate">
            {isCircle ? 'Ephemeral circle media expires after 24 hours' : 'Ephemeral group media expires after 24 hours'}
          </p>
        </div>
      </div>
    );
  }

  // 2. Active Unexpired State
  return (
    <>
      <div 
        id={`group-media-asset-${assetState.id}`}
        className={`relative group rounded-2xl border transition-all ${
          isMine 
            ? 'bg-stone-900/90 border-stone-800/90' 
            : 'bg-stone-900 border-stone-800/80'
        }`}
      >
        {/* Media Content Display */}
        <div className="relative rounded-t-2xl overflow-hidden max-w-xs sm:max-w-sm">
          {isLoadingUrl ? (
            <div className="w-64 h-44 bg-stone-950 flex flex-col items-center justify-center gap-2">
              <div className="w-5 h-5 border-2 border-stone-700 border-t-stone-300 rounded-full animate-spin" />
              <span className="text-[11px] text-stone-500">Loading ephemeral media...</span>
            </div>
          ) : signedUrl && assetState.media_type === 'image' ? (
            <div 
              className="relative cursor-pointer overflow-hidden bg-stone-950 flex items-center justify-center"
              onClick={() => setIsModalOpen(true)}
            >
              <img
                src={signedUrl}
                alt={assetState.original_filename || (isCircle ? 'Circle photo' : 'Group photo')}
                className="max-h-72 w-auto object-contain rounded-t-2xl select-none"
                referrerPolicy="no-referrer"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                <span className="p-2 rounded-full bg-stone-900/80 text-stone-200 border border-stone-700/60 shadow-lg">
                  <Maximize2 className="w-4 h-4" />
                </span>
              </div>
            </div>
          ) : assetState.media_type === 'video' ? (
            <div className="w-64 sm:w-72 rounded-t-2xl overflow-hidden bg-stone-950 relative group/video">
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
          ) : assetState.media_type === 'audio' ? (
            <div className="w-64 p-3 rounded-t-2xl bg-stone-950">
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
          ) : (
            <div className="w-64 p-3 rounded-t-2xl flex items-center gap-3 bg-stone-950">
              <div className="w-8 h-8 rounded-lg bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-300 shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-stone-200 truncate">
                  {assetState.original_filename || 'Attachment'}
                </p>
                {assetState.file_size_bytes && (
                  <p className="text-[10px] text-stone-500">
                    {formatFileSize(assetState.file_size_bytes)}
                  </p>
                )}
              </div>
              {signedUrl && (
                <a
                  href={signedUrl}
                  download={assetState.original_filename || 'download'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 transition-colors"
                  title="Download file"
                  aria-label="Download attachment"
                >
                  <Download className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Ephemeral Metadata Footer */}
        <div className="px-3 py-1.5 flex items-center justify-between gap-2 text-[10px] text-stone-400 bg-stone-950/60 rounded-b-2xl border-t border-stone-800/50">
          <div className="flex items-center gap-1.5 min-w-0">
            {assetState.is_saved ? (
              <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                <BookmarkCheck className="w-3 h-3" />
                <span>Saved</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-stone-400" title="Expires 24 hours after upload">
                <Clock className="w-3 h-3 text-stone-500" />
                <span>{formatMediaTimeRemaining(assetState.expires_at, assetState.is_saved)}</span>
              </span>
            )}

            {!assetState.allow_recipient_save && !assetState.is_saved && (
              <span className="inline-flex items-center gap-0.5 text-stone-500" title="Sender restricted saving">
                <Lock className="w-2.5 h-2.5 text-stone-500 ml-1" />
                <span className="text-[9px]">Restricted</span>
              </span>
            )}
          </div>

          {/* Quick Actions & Menu */}
          <div className="relative flex items-center gap-1">
            {canSave && (
              <button
                type="button"
                id={`btn-save-media-${assetState.id}`}
                disabled={isSaving}
                onClick={handleSave}
                className="p-1 rounded-md text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
                title={saveLabel}
              >
                <Bookmark className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              id={`btn-media-menu-${assetState.id}`}
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-1 rounded-md text-stone-500 hover:text-stone-300 hover:bg-stone-800 transition-colors cursor-pointer"
              title="More options"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            {/* Context Menu Dropdown: Positioned above button with transparent backdrop, completely unclipped */}
            {isMenuOpen && (
              <>
                <div 
                  className="fixed inset-0 z-30" 
                  onClick={() => setIsMenuOpen(false)} 
                />
                <div 
                  id={`group-media-menu-${assetState.id}`}
                  className="absolute right-0 bottom-full mb-1.5 w-48 rounded-xl bg-stone-900 border border-stone-800 shadow-2xl py-1 z-40 animate-in fade-in zoom-in-95"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canSave && (
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={isSaving}
                      className="w-full px-3 py-2 text-left text-xs text-stone-200 hover:bg-stone-800 flex items-center gap-2 cursor-pointer transition-colors"
                    >
                      <Bookmark className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                      <span className="truncate">{isSaving ? 'Saving...' : saveLabel}</span>
                    </button>
                  )}

                  {signedUrl && (
                    <a
                      href={signedUrl}
                      download={assetState.original_filename || 'download'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full px-3 py-2 text-left text-xs text-stone-200 hover:bg-stone-800 flex items-center gap-2 cursor-pointer transition-colors"
                    >
                      <Download className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                      <span>Download</span>
                    </a>
                  )}

                  <div className="px-3 py-1.5 text-[10px] text-stone-500 border-t border-stone-800 flex flex-col gap-0.5">
                    <div className="flex items-center gap-1">
                      <Info className="w-3 h-3 text-stone-500 shrink-0" />
                      <span className="truncate">{infoTitle}</span>
                    </div>
                    <span>Expires 24h after send</span>
                  </div>

                  {feedbackMessage && (
                    <div className="px-3 py-1 text-[10px] text-emerald-400 bg-emerald-950/40 border-t border-emerald-900/50">
                      {feedbackMessage}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen Preview Modal */}
      {isModalOpen && signedUrl && (
        <div 
          id={`group-media-modal-${assetState.id}`}
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in"
          onClick={() => setIsModalOpen(false)}
        >
          {/* Header controls */}
          <div 
            className="absolute top-4 left-4 right-4 flex items-center justify-between text-stone-300 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 min-w-0 pr-4">
              <span className="text-xs text-stone-300 font-medium truncate">
                {assetState.original_filename || (isCircle ? 'Circle Media' : 'Group Media')}
              </span>
              <span className="text-xs text-stone-600 shrink-0">•</span>
              <span className="text-xs text-stone-400 shrink-0">
                {assetState.is_saved ? 'Saved' : formatMediaTimeRemaining(assetState.expires_at, assetState.is_saved)}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {assetState.media_type === 'image' && (
                <button
                  type="button"
                  onClick={() => setIsRotated(!isRotated)}
                  className="p-2 rounded-xl bg-stone-900/80 hover:bg-stone-800 text-stone-300 border border-stone-800 transition-colors cursor-pointer"
                  title="Rotate image"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              )}

              {canSave && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium border border-stone-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving...' : 'Save'}</span>
                </button>
              )}

              <a
                href={signedUrl}
                download={assetState.original_filename || 'download'}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-xl bg-stone-900/80 hover:bg-stone-800 text-stone-300 border border-stone-800 transition-colors cursor-pointer"
                title="Download"
              >
                <Download className="w-4 h-4" />
              </a>

              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-2 rounded-xl bg-stone-900/80 hover:bg-stone-800 text-stone-300 border border-stone-800 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Centered Media (Image or Video) */}
          <div 
            className="max-w-full max-h-full p-2 flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {assetState.media_type === 'video' ? (
              <video
                src={signedUrl}
                controls
                autoPlay
                playsInline
                className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
              />
            ) : (
              <img
                src={signedUrl}
                alt={assetState.original_filename || 'Media preview'}
                className={`max-h-[85vh] max-w-[90vw] object-contain rounded-lg transition-transform duration-200 select-none shadow-2xl ${
                  isRotated ? 'rotate-90' : ''
                }`}
                referrerPolicy="no-referrer"
              />
            )}
          </div>
        </div>
      )}
    </>
  );
};
