/**
 * Application environment and foundation status types.
 */

export interface EnvironmentStatus {
  supabaseConfigured: boolean;
  supabaseUrl: string | null;
  hasPublishableKey: boolean;
  isProduction: boolean;
  nodeEnv: string;
}

export interface VerificationItem {
  id: string;
  name: string;
  status: 'verified' | 'pending' | 'ready';
  description: string;
}
