import { AuthUrlParams } from './types';

/**
 * Parses authentication-related parameters from both the URL search query and the URL hash.
 * Supabase returns tokens and error states in the hash fragment (e.g. #access_token=...&type=recovery or #error=access_denied&error_code=otp_expired)
 * or in query parameters (e.g. ?error=... or ?code=...).
 */
export function parseAuthUrlParams(): AuthUrlParams {
  if (typeof window === 'undefined') {
    return {};
  }

  const result: AuthUrlParams = {};

  // 1. Check URL search query
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has('type')) result.type = searchParams.get('type');
  if (searchParams.has('error')) result.error = searchParams.get('error');
  if (searchParams.has('error_code')) result.errorCode = searchParams.get('error_code');
  if (searchParams.has('error_description')) result.errorDescription = searchParams.get('error_description');

  // 2. Check URL hash fragment
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.substring(1)
    : window.location.hash;

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
  }

  return result;
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
 */
export function clearAuthUrlParams(): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  url.searchParams.delete('error');
  url.searchParams.delete('error_code');
  url.searchParams.delete('error_description');
  url.searchParams.delete('type');
  url.searchParams.delete('code');
  url.hash = '';

  window.history.replaceState({}, document.title, url.pathname);
}
