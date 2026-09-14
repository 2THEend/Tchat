/**
 * Conversations Domain Validation & Temporal Helpers
 */

export const MIN_MESSAGE_LENGTH = 1;
export const MAX_MESSAGE_LENGTH = 2000;

export interface MessageValidationResult {
  isValid: boolean;
  error?: string;
  cleanContent: string;
}

/**
 * Validates text message content according to product rules:
 * - Reject empty or whitespace-only messages
 * - Enforce maximum character limit of 2000
 * - Normalizes trimmed text
 */
export function validateTextMessageContent(content: string | null | undefined): MessageValidationResult {
  if (content === null || content === undefined) {
    return {
      isValid: false,
      error: 'Message content cannot be empty.',
      cleanContent: '',
    };
  }

  const clean = content.trim();

  if (clean.length < MIN_MESSAGE_LENGTH) {
    return {
      isValid: false,
      error: 'Message content cannot be empty.',
      cleanContent: '',
    };
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    return {
      isValid: false,
      error: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters.`,
      cleanContent: clean,
    };
  }

  return {
    isValid: true,
    cleanContent: clean,
  };
}

/**
 * Canonical pair ordering invariant: user_a_id < user_b_id
 * Guarantees a deterministic, unique 1:1 conversation relationship.
 */
export function getCanonicalConversationPair(userId1: string, userId2: string): { user_a_id: string; user_b_id: string } {
  if (!userId1 || !userId2) {
    throw new Error('Both participant user IDs must be provided.');
  }

  if (userId1 === userId2) {
    throw new Error('Cannot create a 1:1 conversation with oneself.');
  }

  return {
    user_a_id: userId1 < userId2 ? userId1 : userId2,
    user_b_id: userId1 < userId2 ? userId2 : userId1,
  };
}

/**
 * Determines if a conversation was meaningfully active during the user's current local day.
 * 
 * Product Rules:
 * - A conversation is only considered active for Home when meaningful interaction occurs.
 * - Accepting a connection does NOT create Home activity (last_activity_at remains null).
 * - Opening a conversation does NOT create Home activity.
 * - Reading messages does NOT create Home activity.
 * - Sending or receiving a message DOES create activity.
 * - The user's local day is the boundary rule, NOT UTC calendar dates.
 * - An inactive conversation leaves Home after the local day ends, but remains in History/Archive.
 * 
 * @param lastActivityAt ISO timestamp string of the last meaningful communication event
 * @param clientTimezone Optional IANA timezone identifier (e.g. 'America/New_York'). Defaults to user's system timezone.
 * @param referenceDate Optional reference Date for testability. Defaults to now.
 */
export function isConversationActiveToday(
  lastActivityAt: string | null | undefined,
  clientTimezone?: string,
  referenceDate: Date = new Date()
): boolean {
  if (!lastActivityAt) {
    return false;
  }

  const activityDate = new Date(lastActivityAt);
  if (isNaN(activityDate.getTime())) {
    return false;
  }

  const timeZone = clientTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  try {
    // Format YYYY-MM-DD in the target user's local timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const todayDateStr = formatter.format(referenceDate);
    const activityDateStr = formatter.format(activityDate);

    return todayDateStr === activityDateStr;
  } catch {
    // Fallback to local date comparison if timezone string is unrecognized
    const today = new Date(referenceDate);
    return (
      today.getFullYear() === activityDate.getFullYear() &&
      today.getMonth() === activityDate.getMonth() &&
      today.getDate() === activityDate.getDate()
    );
  }
}
