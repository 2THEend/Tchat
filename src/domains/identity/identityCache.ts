/**
 * Identity Caching Layer for Tchat.
 * 
 * Provides synchronous client-side retrieval of the last verified profile
 * and account snapshots to prevent blocking full-screen loading flickers 
 * ("Checking session...", "Resolving Tchat identity...") during app reopen,
 * tab reload, and background resume.
 * 
 * Rules:
 * - Read safely from localStorage (guard against private mode exceptions).
 * - Never treat cached identity as an authorization source for sensitive operations;
 *   Supabase session and PostgreSQL RLS remain the authoritative security boundary.
 * - Clear immediately on sign out or auth invalidation.
 */

import { TchatAccount, TchatProfile } from './types';

const IDENTITY_CACHE_KEY = 'tchat_cached_identity_v1';

export interface CachedIdentity {
  userId: string;
  userEmail?: string | null;
  profile: TchatProfile;
  account: TchatAccount;
  cachedAt: number;
}

export function getCachedIdentity(): CachedIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.userId && parsed.profile && parsed.account) {
      return parsed as CachedIdentity;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCachedIdentity(
  userId: string,
  profile: TchatProfile,
  account: TchatAccount,
  userEmail?: string | null
): void {
  try {
    const payload: CachedIdentity = {
      userId,
      userEmail: userEmail || account.email || null,
      profile,
      account,
      cachedAt: Date.now(),
    };
    localStorage.setItem(IDENTITY_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Gracefully handle storage quota or access denial
  }
}

export function clearCachedIdentity(): void {
  try {
    localStorage.removeItem(IDENTITY_CACHE_KEY);
  } catch {
    // Gracefully ignore
  }
}
