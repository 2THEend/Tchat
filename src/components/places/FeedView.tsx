import React, { useState, useEffect, useCallback } from 'react';
import { 
  Compass, 
  RotateCw, 
  Send, 
  User, 
  Clock, 
  Sparkles, 
  AlertCircle,
  Database
} from 'lucide-react';
import { TchatFeedPost } from '../../domains/feed/types';
import { createFeedPost, getActiveFeedPosts } from '../../domains/feed/feedService';
import { MAX_FEED_POST_LENGTH } from '../../domains/feed/validation';
import { OtherUserProfileModal } from '../profile/OtherUserProfileModal';

interface FeedViewProps {
  currentUserId?: string;
  onOpenProfile?: (userId: string) => void;
}

function formatPostTime(createdStr: string, expiresStr: string): { timeAgo: string; timeLeft: string } {
  try {
    const created = new Date(createdStr).getTime();
    const expires = new Date(expiresStr).getTime();
    const now = Date.now();

    const diffCreated = Math.max(0, now - created);
    const minsAgo = Math.floor(diffCreated / (60 * 1000));
    const hoursAgo = Math.floor(minsAgo / 60);

    let timeAgo = 'Just now';
    if (hoursAgo > 0) {
      timeAgo = `${hoursAgo}h ago`;
    } else if (minsAgo > 0) {
      timeAgo = `${minsAgo}m ago`;
    }

    const diffExpires = Math.max(0, expires - now);
    const minsLeft = Math.floor(diffExpires / (60 * 1000));
    const hoursLeft = Math.floor(minsLeft / 60);

    let timeLeft = 'Expiring soon';
    if (hoursLeft > 0) {
      timeLeft = `${hoursLeft}h left`;
    } else if (minsLeft > 0) {
      timeLeft = `${minsLeft}m left`;
    }

    return { timeAgo, timeLeft };
  } catch {
    return { timeAgo: '', timeLeft: '' };
  }
}

export const FeedView: React.FC<FeedViewProps> = ({
  currentUserId,
  onOpenProfile,
}) => {
  const [posts, setPosts] = useState<TchatFeedPost[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [isSchemaPending, setIsSchemaPending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Compose State
  const [draftContent, setDraftContent] = useState<string>('');
  const [composeError, setComposeError] = useState<string | null>(null);

  // Profile Modal State
  const [viewingProfileUserId, setViewingProfileUserId] = useState<string | null>(null);

  const loadFeed = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setErrorMessage(null);

    try {
      const res = await getActiveFeedPosts();
      if (res.isSchemaPending) {
        setIsSchemaPending(true);
        setPosts([]);
      } else if (res.error) {
        setErrorMessage(res.error);
        setPosts([]);
      } else {
        setIsSchemaPending(false);
        setPosts(res.data || []);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load feed.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setComposeError(null);

    const trimmed = draftContent.trim();
    if (!trimmed) {
      setComposeError('Post content cannot be empty.');
      return;
    }

    if (draftContent.length > MAX_FEED_POST_LENGTH) {
      setComposeError(`Post exceeds maximum limit of ${MAX_FEED_POST_LENGTH} characters.`);
      return;
    }

    setIsPublishing(true);
    try {
      const res = await createFeedPost(trimmed);
      if (res.error) {
        setComposeError(res.error);
      } else {
        setDraftContent('');
        await loadFeed(true);
      }
    } catch (err: any) {
      setComposeError(err?.message || 'Failed to publish post.');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleAuthorClick = (authorId: string) => {
    if (onOpenProfile) {
      onOpenProfile(authorId);
    } else {
      setViewingProfileUserId(authorId);
    }
  };

  return (
    <div 
      id="feed-view-container" 
      className="flex-1 overflow-y-auto px-5 py-6 space-y-6"
    >
      {/* 1. Header with Refresh */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-stone-400 font-mono">
            Discovery Space
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-stone-100">
            Feed
          </h1>
        </div>

        <button
          id="btn-refresh-feed"
          type="button"
          onClick={() => loadFeed(true)}
          disabled={isLoading || isRefreshing}
          aria-label="Refresh feed"
          className="w-8 h-8 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-400 hover:text-stone-200 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
        </button>
      </div>

      {/* 2. Compose Perspective */}
      <form 
        id="feed-compose-form"
        onSubmit={handlePublish}
        className="p-4 rounded-2xl bg-stone-900/60 border border-stone-800/80 space-y-3"
      >
        <div className="flex items-center gap-2 text-xs font-medium text-stone-300">
          <Sparkles className="w-3.5 h-3.5 text-stone-400" />
          <span>Share an Ephemeral Perspective</span>
          <span className="text-[10px] text-stone-400 font-mono ml-auto">
            Expires in 24h
          </span>
        </div>

        <div className="relative">
          <textarea
            id="input-feed-compose"
            rows={3}
            value={draftContent}
            onChange={(e) => {
              setDraftContent(e.target.value);
              if (composeError) setComposeError(null);
            }}
            placeholder="Share a perspective with the community (24h lifespan)..."
            maxLength={MAX_FEED_POST_LENGTH}
            className="w-full bg-stone-950/80 border border-stone-800 rounded-xl p-3 text-xs text-stone-100 placeholder:text-stone-400 focus:outline-hidden focus:border-stone-600 resize-none transition-colors"
          />

          <div className="flex items-center justify-between pt-1">
            <span className={`text-[10px] font-mono ${
              draftContent.length > MAX_FEED_POST_LENGTH ? 'text-red-400' : 'text-stone-400'
            }`}>
              {draftContent.length} / {MAX_FEED_POST_LENGTH}
            </span>

            <button
              id="btn-publish-feed-post"
              type="submit"
              disabled={isPublishing || !draftContent.trim() || draftContent.length > MAX_FEED_POST_LENGTH}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-white text-stone-950 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Send className="w-3 h-3" />
              <span>{isPublishing ? 'Sharing...' : 'Share'}</span>
            </button>
          </div>
        </div>

        {composeError && (
          <div className="p-2.5 rounded-xl bg-red-950/30 border border-red-900/40 text-red-300 text-[11px] flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{composeError}</span>
          </div>
        )}
      </form>

      {/* 3. Schema Pending Alert */}
      {isSchemaPending && (
        <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-900/30 text-amber-200 text-xs space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <Database className="w-4 h-4 text-amber-400" />
            <span>Feed Schema Pending</span>
          </div>
          <p className="text-[11px] text-amber-300/80">
            Feed migrations are awaiting execution in the database.
          </p>
        </div>
      )}

      {/* 4. Error State */}
      {errorMessage && !isSchemaPending && (
        <div className="p-4 rounded-2xl bg-red-950/30 border border-red-900/40 text-red-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="truncate">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => loadFeed()}
            className="text-[11px] font-semibold underline underline-offset-2 shrink-0 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* 5. Posts Feed Stream */}
      <div className="space-y-3" id="feed-posts-stream">
        {isLoading ? (
          <div className="p-8 rounded-2xl bg-stone-900/40 border border-stone-800/60 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-stone-600 border-t-stone-200 rounded-full animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div 
            id="feed-empty-state"
            className="p-6 rounded-2xl bg-stone-900/40 border border-stone-800/60 text-center space-y-2"
          >
            <Compass className="w-6 h-6 text-stone-400 mx-auto" />
            <p className="text-xs font-semibold text-stone-200">
              No active perspectives
            </p>
            <p className="text-[11px] text-stone-400 max-w-xs mx-auto leading-relaxed">
              Feed posts expire automatically after 24 hours. Be the first to share an ephemeral perspective with the community.
            </p>
          </div>
        ) : (
          posts.map((post) => {
            const { timeAgo, timeLeft } = formatPostTime(post.created_at, post.expires_at);

            return (
              <article
                key={post.id}
                id={`feed-post-${post.id}`}
                className="p-4 rounded-2xl bg-stone-900/70 border border-stone-800/80 space-y-3 text-left transition-colors"
              >
                {/* Author Bar */}
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleAuthorClick(post.author_id)}
                    className="flex items-center gap-2.5 min-w-0 text-left hover:opacity-85 transition-opacity cursor-pointer group"
                    title={`View ${post.author_display_name || post.author_username}'s profile`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-stone-800 border border-stone-700/60 flex items-center justify-center text-stone-300 overflow-hidden shrink-0">
                      {post.author_avatar_url ? (
                        <img
                          src={post.author_avatar_url}
                          alt={post.author_display_name || post.author_username}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="w-4 h-4 text-stone-400" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-stone-100 truncate group-hover:text-white">
                        {post.author_display_name || post.author_username}
                      </div>
                      <div className="text-[10px] font-mono text-stone-400 truncate">
                        @{post.author_username}
                      </div>
                    </div>
                  </button>

                  {/* Temporal Expiration Metadata */}
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-stone-400 shrink-0">
                    <span>{timeAgo}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1 text-amber-400/90">
                      <Clock className="w-2.5 h-2.5" />
                      {timeLeft}
                    </span>
                  </div>
                </div>

                {/* Post Content */}
                <div className="text-xs text-stone-200 leading-relaxed whitespace-pre-wrap break-words pl-0.5">
                  {post.content}
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* Author Profile Modal */}
      {viewingProfileUserId && (
        <OtherUserProfileModal
          targetUserId={viewingProfileUserId}
          currentUserId={currentUserId}
          isOpen={!!viewingProfileUserId}
          onClose={() => setViewingProfileUserId(null)}
        />
      )}
    </div>
  );
};
