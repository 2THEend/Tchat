export interface TchatAccount {
  id: string;
  status: 'active' | 'suspended' | 'deactivated';
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface TchatProfile {
  id: string;
  username: string;
  normalized_username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdentitySetupInput {
  username: string;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
}

export interface UpdateProfileInput {
  username: string;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
}

export type ProfileRelationshipStatus = 
  | 'self' 
  | 'not_connected' 
  | 'request_sent' 
  | 'request_received' 
  | 'connected' 
  | 'blocked' 
  | 'viewer_blocked';

export interface OtherUserProfile {
  id: string;
  username: string;
  normalized_username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at?: string;
  relationship: {
    status: ProfileRelationshipStatus;
    pending_request_id?: string | null;
    request_context?: string | null;
    conversation_id?: string | null;
  };
}

export interface IdentityStatus {
  isChecking: boolean;
  hasProfile: boolean;
  profile: TchatProfile | null;
  account: TchatAccount | null;
  error: string | null;
}
