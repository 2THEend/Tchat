/**
 * Supabase Client initialization for Tchat.
 * 
 * Rules:
 * - Never expose Supabase service-role or secret keys to the client.
 * - Use publishable key only (VITE_SUPABASE_PUBLISHABLE_KEY or fallback VITE_SUPABASE_ANON_KEY).
 * - Graceful fallback when environment variables are not yet configured.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

let supabaseInstance: SupabaseClient | null = null;

if (env.isSupabaseConfigured && env.supabaseUrl && env.supabasePublishableKey) {
  try {
    supabaseInstance = createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    supabaseInstance = null;
  }
}

export function getSupabase(): SupabaseClient | null {
  return supabaseInstance;
}

export function isSupabaseReady(): boolean {
  return supabaseInstance !== null;
}

export const supabase = supabaseInstance;
