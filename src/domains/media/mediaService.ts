/**
 * Ephemeral Media Service Layer
 * Interfaces with Supabase Storage and PostgreSQL RPCs.
 */

import { supabase } from '../../lib/supabase';
import { 
  TchatMediaAsset, 
  MediaUploadOptions, 
  MediaServiceResult 
} from './types';
import { 
  validateMediaFile, 
  isMediaExpired 
} from './validation';
import { emitMediaEvent } from './events';

function isPendingSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = err.message || '';
  const code = err.code || '';
  return (
    code === '42P01' || // undefined_table
    code === 'PGRST202' || // function not found
    code === 'PGRST204' || // table not found
    msg.includes('schema cache') ||
    msg.includes('media_assets') ||
    msg.includes('function create_media_asset') ||
    msg.includes('function save_media_asset') ||
    msg.includes('function get_media_access')
  );
}

// Memory cache for short-lived signed URLs to prevent repetitive requests
interface SignedUrlCacheEntry {
  url: string;
  expiresAtMs: number;
}
const signedUrlCache = new Map<string, SignedUrlCacheEntry>();

/**
 * Uploads a validated media file to private Supabase Storage
 * and creates the authoritative MediaAsset in PostgreSQL.
 */
export async function uploadMediaFile(
  conversationId: string,
  file: File,
  options?: MediaUploadOptions
): Promise<MediaServiceResult<TchatMediaAsset>> {
  if (!supabase) {
    return { error: 'Supabase client is not initialized.' };
  }

  // 1. Client-Side Validation
  const validation = validateMediaFile(file);
  if (!validation.isValid || !validation.mediaType || !validation.cleanFilename) {
    return { error: validation.error || 'Invalid media file.' };
  }

  try {
    // 2. Build Storage Path: ${conversationId}/${assetId}-${cleanFilename}
    const uniqueId = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const storagePath = `${conversationId}/${uniqueId}-${validation.cleanFilename}`;

    // 3. Upload to Private 'conversation-media' Bucket
    // cacheControl: 'no-cache' ensures client does not cache private ephemeral media
    const { error: uploadError } = await supabase.storage
      .from('conversation-media')
      .upload(storagePath, file, {
        cacheControl: 'no-cache, no-store, must-revalidate',
        upsert: false,
      });

    if (uploadError) {
      console.error('[MediaService] Storage upload failed:', uploadError);
      return { 
        error: uploadError.message || 'Failed to upload media to secure storage.' 
      };
    }

    // 4. Register Media Asset via Server RPC
    const allowSave = options?.allowRecipientSave !== false;
    const { data, error: rpcError } = await supabase.rpc('create_media_asset', {
      p_conversation_id: conversationId,
      p_storage_path: storagePath,
      p_media_type: validation.mediaType,
      p_mime_type: file.type,
      p_file_size_bytes: file.size,
      p_original_filename: validation.cleanFilename,
      p_allow_recipient_save: allowSave,
    });

    if (rpcError) {
      if (isPendingSchemaError(rpcError)) {
        return { isSchemaPending: true, error: rpcError.message };
      }
      return { error: rpcError.message };
    }

    const asset: TchatMediaAsset = {
      id: data.id,
      conversation_id: data.conversation_id,
      uploader_id: data.uploader_id,
      storage_path: data.storage_path,
      media_type: data.media_type,
      mime_type: data.mime_type,
      file_size_bytes: data.file_size_bytes,
      original_filename: data.original_filename,
      allow_recipient_save: data.allow_recipient_save,
      is_saved: data.is_saved,
      saved_at: data.saved_at,
      saved_by_id: data.saved_by_id,
      expires_at: data.expires_at,
      created_at: data.created_at,
      is_expired: false,
    };

    emitMediaEvent({
      type: 'media:created',
      mediaAssetId: asset.id,
      conversationId,
      asset,
      timestamp: asset.created_at,
    });

    return { data: asset };
  } catch (err: any) {
    if (isPendingSchemaError(err)) {
      return { isSchemaPending: true, error: err?.message };
    }
    return { error: err?.message || 'Media upload failed.' };
  }
}

/**
 * Explicitly saves a media asset, converting it from ephemeral (24h)
 * to persistent in the conversation.
 */
export async function saveMediaAsset(
  mediaAssetId: string,
  conversationId: string,
  userId: string
): Promise<MediaServiceResult<TchatMediaAsset>> {
  if (!supabase) {
    return { error: 'Supabase client is not initialized.' };
  }

  try {
    const { data, error } = await supabase.rpc('save_media_asset', {
      p_media_asset_id: mediaAssetId,
    });

    if (error) {
      if (isPendingSchemaError(error)) {
        return { isSchemaPending: true, error: error.message };
      }
      return { error: error.message };
    }

    const updatedAsset: TchatMediaAsset = {
      id: data.id,
      conversation_id: data.conversation_id,
      uploader_id: data.uploader_id,
      storage_path: data.storage_path,
      media_type: data.media_type,
      mime_type: data.mime_type,
      file_size_bytes: data.file_size_bytes,
      original_filename: data.original_filename,
      allow_recipient_save: data.allow_recipient_save,
      is_saved: true,
      saved_at: data.saved_at,
      saved_by_id: data.saved_by_id,
      expires_at: data.expires_at,
      created_at: data.created_at,
      is_expired: false,
    };

    emitMediaEvent({
      type: 'media:saved',
      mediaAssetId,
      conversationId,
      asset: updatedAsset,
      savedByUserId: userId,
      timestamp: new Date().toISOString(),
    });

    return { data: updatedAsset };
  } catch (err: any) {
    return { error: err?.message || 'Failed to save media asset.' };
  }
}

/**
 * Fetches short-lived signed URL for an unexpired or saved media asset.
 * Enforces server and client-side expiration checks.
 */
export async function getSignedMediaUrl(
  storagePath: string | null | undefined,
  mediaAssetId: string,
  isSaved: boolean,
  expiresAt: string
): Promise<string | null> {
  if (!supabase || !storagePath) return null;

  // Immediate expiration check
  if (isMediaExpired(expiresAt, isSaved)) {
    // Clear cache if previously cached
    signedUrlCache.delete(storagePath);
    return null;
  }

  // Check in-memory cache
  const cached = signedUrlCache.get(storagePath);
  const now = Date.now();
  if (cached && cached.expiresAtMs > now + 30000) {
    // Valid for at least another 30 seconds
    return cached.url;
  }

  try {
    // Request short-lived signed URL (300 seconds = 5 minutes)
    const { data, error } = await supabase.storage
      .from('conversation-media')
      .createSignedUrl(storagePath, 300);

    if (error || !data?.signedUrl) {
      console.warn('[MediaService] Could not generate signed URL:', error?.message);
      return null;
    }

    signedUrlCache.set(storagePath, {
      url: data.signedUrl,
      expiresAtMs: now + 270000, // 4.5 minutes
    });

    return data.signedUrl;
  } catch (err) {
    console.warn('[MediaService] Signed URL exception:', err);
    return null;
  }
}

/**
 * Clears signed URL cache for a specific media asset or all assets.
 */
export function clearSignedUrlCache(storagePath?: string): void {
  if (storagePath) {
    signedUrlCache.delete(storagePath);
  } else {
    signedUrlCache.clear();
  }
}
