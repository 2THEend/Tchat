/**
 * Connections Domain Types for Tchat.
 * 
 * Defines data structures for:
 * - Intentional 1:1 human connections
 * - Connection requests with required context/reason
 * - Safety & access restriction blocks
 * - Minimal public discovery profiles
 */

export type ConnectionRequestStatus = 
  | 'pending' 
  | 'accepted' 
  | 'declined' 
  | 'ignored' 
  | 'cancelled';

export type ConnectionRelationshipStatus = 
  | 'none' 
  | 'connected' 
  | 'request_sent' 
  | 'request_received' 
  | 'blocked';

export interface TchatProfileSummary {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  relationship_status?: ConnectionRelationshipStatus;
}

export interface TchatConnection {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
  updated_at: string;
  other_user?: TchatProfileSummary;
}

export interface TchatConnectionRequest {
  id: string;
  sender_id: string;
  recipient_id: string;
  context: string;
  status: ConnectionRequestStatus;
  created_at: string;
  updated_at: string;
  sender?: TchatProfileSummary;
  recipient?: TchatProfileSummary;
}

export interface TchatBlock {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
  blocked_user?: TchatProfileSummary;
}

export interface SendRequestInput {
  recipientId: string;
  context: string;
}

export type ConnectionsActiveTab = 
  | 'connections' 
  | 'incoming' 
  | 'sent' 
  | 'find' 
  | 'blocked';
