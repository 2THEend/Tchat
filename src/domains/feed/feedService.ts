/**
 * Feed Domain Service Layer
 * Interfaces directly with Supabase PostgreSQL RPCs.
 */

import { supabase } from '../../lib/supabase';
import { TchatFeedPost, FeedServiceResult } from './types';
import { validateFeedPostContent } from './validation';

function isPendingSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = err.message || '';
  const code = err.code || '';
  return (
    code === '42P01' || // undefined_table
    code === 'PGRST202' || // function not found
    code === 'PGRST204' || // table not found
    msg.includes('schema cache') ||
    msg.includes('feed_posts') ||
    msg.includes('create_feed_post') ||
    msg.includes('get_active_feed_posts')
  );
}

/**
 * Creates an ephemeral Feed post with authoritative 24-hour expiration.
 */
export async function createFeedPost(
  content: string
): Promise<FeedServiceResult<string>> {
  if (!supabase) {
    return { error: 'Supabase client is not initialized.' };
  }

  const validation = validateFeedPostContent(content);
  if (!validation.isValid) {
    return { error: validation.error };
  }

  try {
    const { data, error } = await supabase.rpc('create_feed_post', {
      p_content: validation.cleanContent,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { isSchemaPending: true, error: error.message };
      }
      return { error: error.message };
    }

    return { data: data as string };
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { isSchemaPending: true, error: err?.message };
    }
    return { error: err?.message || 'Failed to publish post.' };
  }
}

/**
 * Retrieves all active, unexpired Feed posts excluding blocked relationships.
 * Ordered chronologically (newest first).
 */
export async function getActiveFeedPosts(): Promise<FeedServiceResult<TchatFeedPost[]>> {
  if (!supabase) {
    return { data: [], error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_active_feed_posts');

    if (error) {
      if (isPendingSchemaError(error)) {
        return { data: [], isSchemaPending: true, error: error.message };
      }
      return { data: [], error: error.message };
    }

    const posts: TchatFeedPost[] = (data || []).map((row: any) => ({
      id: row.id,
      author_id: row.author_id,
      content: row.content,
      created_at: row.created_at,
      expires_at: row.expires_at,
      author_username: row.author_username,
      author_display_name: row.author_display_name,
      author_avatar_url: row.author_avatar_url,
    }));

    return { data: posts };
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { data: [], isSchemaPending: true, error: err?.message };
    }
    return { data: [], error: err?.message || 'Failed to fetch feed posts.' };
  }
}
