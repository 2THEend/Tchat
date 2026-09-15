/**
 * Conversation State & Draft Resilience Layer for Tchat.
 * 
 * Manages lightweight client-side persistence for:
 * 1. Active conversation ID (via sessionStorage and URL hash #c=<id>)
 *    to survive mobile browser tab reloads, low-memory background suspensions,
 *    and process recreation.
 * 2. In-progress text draft (via sessionStorage keyed by conversationId)
 *    so user-typed text does not vanish if the OS pauses or reloads the tab.
 * 
 * Rules:
 * - DO NOT serialize or store File/Blob objects in sessionStorage.
 * - Store only the minimal conversation identifier.
 * - Clear active conversation on explicit user exit or navigation away.
 * - Supabase RLS and server-side authorization remain the source of truth;
 *   restoration always verifies that the current user is an authorized participant.
 */

const ACTIVE_CONV_STORAGE_KEY = 'tchat_active_conv_id';
const DRAFT_STORAGE_PREFIX = 'tchat_draft_';

/**
 * Extracts conversation ID from the URL hash (e.g. #c=uuid or #conversation=uuid)
 */
export function getConversationIdFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const hash = window.location.hash;
    if (!hash) return null;
    const match = hash.match(/^#(?:c|conv|conversation)=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Retrieves the persisted active conversation ID from URL hash or sessionStorage.
 */
export function getStoredActiveConversationId(): string | null {
  // 1. Check URL hash first
  const hashId = getConversationIdFromHash();
  if (hashId) return hashId;

  // 2. Check sessionStorage
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(ACTIVE_CONV_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persists the currently active conversation ID.
 */
export function storeActiveConversationId(conversationId: string): void {
  if (typeof window === 'undefined' || !conversationId) return;
  try {
    window.sessionStorage.setItem(ACTIVE_CONV_STORAGE_KEY, conversationId);
    // Update hash without triggering a full page jump
    const newHash = `#c=${encodeURIComponent(conversationId)}`;
    if (window.location.hash !== newHash) {
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search + newHash
      );
    }
  } catch {
    // Gracefully handle storage errors
  }
}

/**
 * Clears the stored active conversation ID when user leaves the conversation.
 */
export function clearStoredActiveConversationId(): void {
  if (typeof window === 'undefined') return null;
  try {
    window.sessionStorage.removeItem(ACTIVE_CONV_STORAGE_KEY);
    // Clear conversation hash from URL if present
    if (window.location.hash && /^#(?:c|conv|conversation)=/.test(window.location.hash)) {
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search
      );
    }
  } catch {
    // Gracefully handle errors
  }
}

/**
 * Persists an unsent text draft for a conversation in sessionStorage.
 * Strictly accepts string only. NEVER persists File objects.
 */
export function storeConversationDraft(conversationId: string, draftText: string): void {
  if (typeof window === 'undefined' || !conversationId) return;
  try {
    const key = `${DRAFT_STORAGE_PREFIX}${conversationId}`;
    if (draftText && draftText.trim().length > 0) {
      window.sessionStorage.setItem(key, draftText);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Gracefully ignore quota errors
  }
}

/**
 * Retrieves the saved unsent text draft for a conversation.
 */
export function getConversationDraft(conversationId: string): string {
  if (typeof window === 'undefined' || !conversationId) return '';
  try {
    return window.sessionStorage.getItem(`${DRAFT_STORAGE_PREFIX}${conversationId}`) || '';
  } catch {
    return '';
  }
}

/**
 * Clears the saved text draft upon successful message send.
 */
export function clearConversationDraft(conversationId: string): void {
  if (typeof window === 'undefined' || !conversationId) return;
  try {
    window.sessionStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${conversationId}`);
  } catch {
    // Gracefully ignore
  }
}
