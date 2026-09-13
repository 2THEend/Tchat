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

export interface IdentityStatus {
  isChecking: boolean;
  hasProfile: boolean;
  profile: TchatProfile | null;
  account: TchatAccount | null;
  error: string | null;
}
