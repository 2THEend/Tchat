/**
 * Environment configuration for Tchat frontend.
 * Public client-side variables prefixed with VITE_.
 * Robust across browser (import.meta.env) and Node/test environments (process.env).
 */

export interface AppEnv {
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  isSupabaseConfigured: boolean;
  appUrl: string | null;
}

const envSource: Record<string, string | undefined> = 
  typeof import.meta !== 'undefined' && import.meta.env
    ? (import.meta.env as unknown as Record<string, string | undefined>)
    : (typeof process !== 'undefined' && process.env ? process.env : {});

const rawSupabaseUrl = envSource.VITE_SUPABASE_URL?.trim() || '';
const rawSupabasePublishableKey = (
  envSource.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  envSource.VITE_SUPABASE_ANON_KEY?.trim() ||
  ''
);

// Verify URL looks like a valid http/https URL and is not a placeholder
function isValidUrl(val: string): boolean {
  if (!val || val.includes('your-project') || val.includes('YOUR_')) return false;
  try {
    const url = new URL(val);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidKey(val: string): boolean {
  if (!val || val.includes('your-publishable-key') || val.includes('your-anon-key') || val.includes('YOUR_')) return false;
  return val.length > 10;
}

export const env: AppEnv = {
  supabaseUrl: isValidUrl(rawSupabaseUrl) ? rawSupabaseUrl : null,
  supabasePublishableKey: isValidKey(rawSupabasePublishableKey) ? rawSupabasePublishableKey : null,
  isSupabaseConfigured: isValidUrl(rawSupabaseUrl) && isValidKey(rawSupabasePublishableKey),
  appUrl: envSource.VITE_APP_URL || null,
};
