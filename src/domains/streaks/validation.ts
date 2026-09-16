/**
 * Streaks Domain Validation & Pure Business Logic
 * Covers timezone handling, local day calculations, interval overlap mathematics,
 * and dormancy evaluation.
 */

import { StreakType } from './types';

export const VALID_STREAK_TYPES: StreakType[] = ['chat', 'photo', 'video'];

export const DEFAULT_DORMANCY_THRESHOLD_HOURS = 48;

/**
 * Validates if the given string is an approved streak type.
 */
export function isValidStreakType(type: unknown): type is StreakType {
  return typeof type === 'string' && VALID_STREAK_TYPES.includes(type as StreakType);
}

/**
 * Safely resolves the user's current IANA timezone identifier.
 * Defaults to 'UTC' if browser Intl is unavailable or fails.
 */
export function getUserTimezone(): string {
  try {
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && isValidIanaTimezone(tz)) {
        return tz;
      }
    }
  } catch {
    // Fallback gracefully
  }
  return 'UTC';
}

/**
 * Validates if a timezone string is recognized by the Intl runtime.
 */
export function isValidIanaTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Formats a Date object into 'YYYY-MM-DD' in a specified timezone.
 */
export function formatLocalDate(date: Date, timezone: string): string {
  const safeTz = isValidIanaTimezone(timezone) ? timezone : 'UTC';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date); // 'YYYY-MM-DD'
}

/**
 * Derives the local calendar date and corresponding UTC day boundary interval
 * [dayStartUtc, dayEndUtc] for a given timestamp and IANA timezone.
 */
export function calculateLocalDayUtcBounds(
  date: Date,
  timezone: string
): {
  localDate: string;
  dayStartUtc: string;
  dayEndUtc: string;
  validTimezone: string;
} {
  const validTz = isValidIanaTimezone(timezone) ? timezone : 'UTC';
  const localDate = formatLocalDate(date, validTz);

  // Derive UTC instant for start of local day (00:00:00.000)
  // We can construct an ISO-like string and convert it via Date parts or timezone offset
  // In JavaScript, we can parse the local date parts at midnight in that timezone:
  const [yearStr, monthStr, dayStr] = localDate.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Approximate or exact boundary calculation:
  // Using Intl formatToParts to obtain timezone offset at midnight:
  const getUtcTimestampForLocalTime = (y: number, m: number, d: number, hr: number, min: number, sec: number, ms: number): Date => {
    // Create an initial guess in UTC
    const guess = new Date(Date.UTC(y, m - 1, d, hr, min, sec, ms));
    // Get formatted local time parts of this guess in validTz
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: validTz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    
    // Iteratively adjust offset (max 2 iterations handles any standard timezone/DST offset)
    let current = guess;
    for (let i = 0; i < 3; i++) {
      const parts = dtf.formatToParts(current);
      const p: Record<string, number> = {};
      for (const part of parts) {
        if (part.type !== 'literal') {
          p[part.type] = parseInt(part.value, 10);
        }
      }
      // Handle hour 24 if returned by en-US
      if (p.hour === 24) p.hour = 0;

      const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour || 0, p.minute || 0, p.second || 0);
      const targetAsUtc = Date.UTC(y, m - 1, d, hr, min, sec);
      const diff = targetAsUtc - localAsUtc;
      if (diff === 0) break;
      current = new Date(current.getTime() + diff);
    }
    return new Date(current.getTime() + ms);
  };

  const start = getUtcTimestampForLocalTime(year, month, day, 0, 0, 0, 0);
  const end = getUtcTimestampForLocalTime(year, month, day, 23, 59, 59, 999);

  return {
    localDate,
    dayStartUtc: start.toISOString(),
    dayEndUtc: end.toISOString(),
    validTimezone: validTz,
  };
}

/**
 * Checks if two UTC day intervals overlap.
 * Overlap condition: startA < endB AND endA > startB
 */
export function doUtcIntervalsOverlap(
  startA: string | Date,
  endA: string | Date,
  startB: string | Date,
  endB: string | Date
): boolean {
  const tStartA = new Date(startA).getTime();
  const tEndA = new Date(endA).getTime();
  const tStartB = new Date(startB).getTime();
  const tEndB = new Date(endB).getTime();

  return tStartA < tEndB && tEndA > tStartB;
}

/**
 * Evaluates whether a streak should be marked dormant based on elapsed time.
 * Dormancy occurs when no new mutual progress has occurred for the configured threshold.
 * If no mutual progress has ever occurred after acceptance, uses acceptedAt as baseline.
 */
export function isStreakDormant(
  lastProgressAt: string | null | undefined,
  acceptedAt: string | null | undefined,
  thresholdHours: number = DEFAULT_DORMANCY_THRESHOLD_HOURS,
  referenceNow: Date = new Date()
): boolean {
  const thresholdMs = thresholdHours * 60 * 60 * 1000;
  const nowMs = referenceNow.getTime();

  if (lastProgressAt) {
    const lastMs = new Date(lastProgressAt).getTime();
    return nowMs - lastMs >= thresholdMs;
  }

  if (acceptedAt) {
    const acceptedMs = new Date(acceptedAt).getTime();
    return nowMs - acceptedMs >= thresholdMs;
  }

  return false;
}

/**
 * Determines whether a streak is eligible for user-initiated manual ending.
 * Only active or dormant streaks can be manually ended.
 * Pending, declined, cancelled, or already-ended streaks cannot be ended.
 */
export function canEndStreak(state: string | null | undefined): boolean {
  return state === 'active' || state === 'dormant';
}
