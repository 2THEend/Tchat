export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
export type MessageType = 'text' | 'media';
export type ActivityType = 'text' | 'media' | 'call';

export interface TchatParticipantProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio?: string | null;
}

export interface TchatConversation {
  id: string;
  connection_id: string | null;
  user_a_id: string;
  user_b_id: string;
  last_activity_at: string | null;
  last_activity_type: ActivityType | null;
  last_message_preview: string | null;
  last_sender_id: string | null;
  created_at: string;
  updated_at: string;
  unread_count?: number;
  other_participant?: TchatParticipantProfile;
}

export interface TchatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_type: MessageType;
  content: string | null;
  media_asset_id: string | null;
  sequence_number: number;
  status: MessageStatus;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
  // Optimistic tracking properties
  client_temp_id?: string;
  error?: string;
}

export interface TchatMediaAsset {
  id: string;
  uploader_id: string;
  storage_path: string;
  media_type: 'image' | 'video' | 'audio';
  mime_type: string | null;
  file_size_bytes: number | null;
  is_ephemeral: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface ConversationsServiceResult<T> {
  data?: T;
  error?: string;
  isSchemaPending?: boolean;
}
