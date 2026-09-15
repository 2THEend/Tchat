/**
 * Ephemeral Media Domain Types
 * Server-authoritative representation of media assets in 1:1 conversations.
 */

export type MediaCategory = 'image' | 'video' | 'audio' | 'file';

export interface TchatMediaAsset {
  id: string;
  conversation_id: string;
  message_id?: string | null;
  uploader_id: string;
  storage_path: string | null;
  media_type: MediaCategory;
  mime_type: string | null;
  file_size_bytes: number | null;
  original_filename: string | null;
  allow_recipient_save: boolean;
  is_saved: boolean;
  saved_at?: string | null;
  saved_by_id?: string | null;
  viewed_at?: string | null;
  expires_at: string; // Authoritative ISO timestamp: sent_at + 24 hours
  created_at: string;
  // Computed & client lifecycle states
  is_expired: boolean;
  signed_url?: string | null;
}

export interface MediaUploadOptions {
  allowRecipientSave?: boolean;
}

export interface MediaValidationResult {
  isValid: boolean;
  error?: string;
  mediaType?: MediaCategory;
  cleanFilename?: string;
}

export interface MediaServiceResult<T> {
  data?: T;
  error?: string;
  isSchemaPending?: boolean;
}
