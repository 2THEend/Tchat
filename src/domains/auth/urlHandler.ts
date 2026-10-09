import { AuthUrlParams } from './types';
import { env } from '../../config/env';

export const DEFAULT_PRODUCTION_APP_URL = 'https://tchat-bay.vercel.app';

/**
 * Resolves the canonical redirect URL for Supabase Auth flows (email verification,
 * password recovery, and Google OAuth).
 *
 * Rules:
 * - If running in a browser with a valid origin (https://tchat-bay.vercel.app, preview URLs,
 *   or http://localhost:3000 during local development), uses that origin unless overridden.
 * - If running in a non-browser context or without a valid window origin, falls back to
 *   VITE_APP_URL or the deployed production Tchat URL (never localhost).
 */
export function getAuthRedirectUrl(
  windowOrigin?: string | null,
  configuredAppUrl?: string | null
): string {
  const explicitAppUrl = (configuredAppUrl ?? env.appUrl)?.trim();
  const currentOrigin =
    windowOrigin !== undefined
      ? windowOrigin
      : typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : null;

  if (currentOrigin && currentOrigin !== 'null') {
    try {
      const parsed = new URL(currentOrigin);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.origin;
      }
    } catch {
      // Fall through to configuredAppUrl / default production URL
    }
  }

  if (explicitAppUrl) {
    try {
      const parsed = new URL(explicitAppUrl);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.origin;
      }
    } catch {
      // Fall through
    }
  }

  return DEFAULT_PRODUCTION_APP_URL;
}

/**
 * Parses authentication-related parameters from both the URL search query and the URL hash.
 * Supabase returns tokens and error states in the hash fragment
 * (e.g. #access_token=...&refresh_token=...&type=signup or #error=access_denied&error_code=otp_expired)
 * or in query parameters (e.g. ?code=... or ?token_hash=...&type=signup).
 */
export function parseAuthUrlParams(
  searchStr?: string,
  hashStr?: string
): AuthUrlParams {
  if (typeof window === 'undefined' && searchStr === undefined && hashStr === undefined) {
    return {};
  }

  const rawSearch = searchStr !== undefined ? searchStr : window.location.search;
  const rawHash = hashStr !== undefined ? hashStr : window.location.hash;

  const result: AuthUrlParams = {};

  // 1. Check URL search query
  const searchParams = new URLSearchParams(rawSearch);
  if (searchParams.has('type')) result.type = searchParams.get('type');
  if (searchParams.has('error')) result.error = searchParams.get('error');
  if (searchParams.has('error_code')) result.errorCode = searchParams.get('error_code');
  if (searchParams.has('error_description')) result.errorDescription = searchParams.get('error_description');
  if (searchParams.has('code')) result.code = searchParams.get('code');
  if (searchParams.has('token_hash')) result.tokenHash = searchParams.get('token_hash');

  // 2. Check URL hash fragment
  const hash = rawHash.startsWith('#') ? rawHash.substring(1) : rawHash;

  if (hash) {
    const hashParams = new URLSearchParams(hash);
    if (!result.type && hashParams.has('type')) result.type = hashParams.get('type');
    if (!result.error && hashParams.has('error')) result.error = hashParams.get('error');
    if (!result.errorCode && hashParams.has('error_code')) result.errorCode = hashParams.get('error_code');
    if (!result.errorDescription && hashParams.has('error_description')) {
      result.errorDescription = hashParams.get('error_description');
    }
    if (hashParams.has('access_token')) {
      result.accessToken = hashParams.get('access_token');
    }
    if (hashParams.has('refresh_token')) {
      result.refreshToken = hashParams.get('refresh_token');
    }
  }

  return result;
}

export function hasAuthUrlParams(params: AuthUrlParams): boolean {
  return Boolean(
    params.type ||
      params.error ||
      params.errorCode ||
      params.errorDescription ||
      params.accessToken ||
      params.refreshToken ||
      params.code ||
      params.tokenHash
  );
}

/**
 * Formats known Supabase error codes into clean, helpful, user-facing error messages.
 */
export function formatAuthUrlError(params: AuthUrlParams): string | null {
  if (!params.error && !params.errorCode && !params.errorDescription) {
    return null;
  }

  const code = (params.errorCode || params.error || '').toLowerCase();
  const desc = (params.errorDescription || '').toLowerCase();

  if (code.includes('otp_expired') || desc.includes('expired') || desc.includes('token has expired')) {
    return 'The verification or recovery link has expired. Please request a new one.';
  }

  if (code.includes('access_denied') || desc.includes('canceled') || desc.includes('cancelled')) {
    return 'Authentication was canceled or denied by the provider.';
  }

  if (desc.includes('provider is not enabled') || desc.includes('unsupported provider')) {
    return 'Google sign-in is not yet enabled in Supabase Auth. Please sign in with Email or Username.';
  }

  if (desc.includes('rate limit') || code.includes('rate_limit') || desc.includes('over_email_send_rate_limit')) {
    return 'Email rate limit exceeded. Please wait a few minutes before trying again.';
  }

  if (params.errorDescription) {
    // Clean up '+' characters often present in URL query encoding
    return params.errorDescription.replace(/\+/g, ' ');
  }

  return 'An unexpected authentication error occurred. Please try again.';
}

/**
 * Removes auth hash and parameters from the browser address bar without reloading the page,
 * ensuring clean navigation and preventing stale state on refresh.
 * IMPORTANT: Call this only AFTER Supabase Auth has consumed any session tokens from the URL.
 */
export function clearAuthUrlParams(): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  url.searchParams.delete('error');
  url.searchParams.delete('error_code');
  url.searchParams.delete('error_description');
  url.searchParams.delete('type');
  url.searchParams.delete('code');
  url.searchParams.delete('token_hash');

  // Only clear hash if it contains auth tokens/errors, preserving non-auth hashes (like #conv=...)
  if (
    url.hash.includes('access_token=') ||
    url.hash.includes('error=') ||
    url.hash.includes('type=')
  ) {
    url.hash = '';
  }

  const search = url.searchParams.toString();
  const nextUrl = url.pathname + (search ? `?${search}` : '') + url.hash;
  window.history.replaceState({}, document.title, nextUrl);
}
