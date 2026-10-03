/**
 * Feed Validation & Bounds
 */

export const MIN_FEED_POST_LENGTH = 1;
export const MAX_FEED_POST_LENGTH = 500;

export interface FeedPostValidationResult {
  isValid: boolean;
  cleanContent: string;
  error?: string;
}

export function validateFeedPostContent(content: string | null | undefined): FeedPostValidationResult {
  if (content === null || content === undefined) {
    return {
      isValid: false,
      cleanContent: '',
      error: 'Post content cannot be empty.',
    };
  }

  const clean = content.trim();

  if (clean.length < MIN_FEED_POST_LENGTH) {
    return {
      isValid: false,
      cleanContent: '',
      error: 'Post content cannot be empty.',
    };
  }

  if (content.length > MAX_FEED_POST_LENGTH) {
    return {
      isValid: false,
      cleanContent: clean,
      error: `Post exceeds maximum limit of ${MAX_FEED_POST_LENGTH} characters.`,
    };
  }

  return {
    isValid: true,
    cleanContent: clean,
  };
}
