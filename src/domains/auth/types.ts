import { User, Session } from '@supabase/supabase-js';

export type AuthMethod = 'google' | 'email' | 'username';
export type AuthMode = 'signin' | 'signup';
export type AuthView = 'signin' | 'signup' | 'forgot_password' | 'reset_password' | 'verify_email';
export type LegalDocumentType = 'terms' | 'privacy';

export interface AuthState {
  isInitialized: boolean;
  isLoading: boolean;
  session: Session | null;
  user: User | null;
  error: string | null;
}

export interface AuthResponse {
  success: boolean;
  error?: string;
  needsEmailVerification?: boolean;
  isRateLimited?: boolean;
}

export interface AuthUrlParams {
  type?: string | null;
  error?: string | null;
  errorCode?: string | null;
  errorDescription?: string | null;
  accessToken?: string | null;
}
