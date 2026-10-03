/**
 * Tchat: Feed Domain Types
 * Phase 1: Minimal Ephemeral Discovery Foundation
 */

export interface TchatFeedPost {
  id: string;
  author_id: string;
  content: string;
  created_at: string;
  expires_at: string;
  author_username: string;
  author_display_name: string | null;
  author_avatar_url: string | null;
}

export interface CreateFeedPostInput {
  content: string;
}

export interface FeedServiceResult<T> {
  data?: T;
  error?: string;
  isSchemaPending?: boolean;
}
