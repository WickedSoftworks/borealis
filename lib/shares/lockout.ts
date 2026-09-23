/**
 * Progressive lockout on a share's password gate.
 *
 * `UNLOCK_FAIL` rows were always written — with the address and user agent —
 * and nothing ever read them back, so a password could be tried as fast as
 * scrypt would run. This turns the record into the brake.
 *
 * Keyed on the SHARE, not on the caller. An attacker can present any address
 * they like on an instance that trusts no proxy (lib/request.ts), and a limit
 * they can dodge by lying is no limit. The price is that a determined attacker
 * can keep a link's recipient waiting, bounded by `MAX_DELAY_MS`; the owner
 * sees every attempt in the access log and can rotate the password, which
 * makes every earlier guess worthless.
 *
 * The schedule: the first few mistakes are free, because recipients mistype.
 * After that each failure doubles the wait, to a ceiling:
 *
 *   failures in the last hour   5    6    7    8    9+
 *   wait after the latest       1m   2m   4m   8m   15m
 *
 * which caps an online guesser at roughly a dozen tries per hour per link.
 *
 * Pure: no database, no clock but the one passed in.
 */

export const LOCKOUT_WINDOW_MS = 60 * 60 * 1000;
export const FREE_ATTEMPTS = 5;
const BASE_DELAY_MS = 60 * 1000;
export const MAX_DELAY_MS = 15 * 60 * 1000;

export type LockoutVerdict =
  | { locked: false }
  | { locked: true; retryAfterMs: number };

/** How long to wait after the `failures`-th failure within the window. */
export function lockoutDelay(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;

  const doublings = failures - FREE_ATTEMPTS;
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** doublings);
}

/**
 * Whether a new attempt may be checked now.
 *
 * `failures` is the times of recent `UNLOCK_FAIL` rows, in any order; only
 * those inside the window count, and one dated in the future — a skewed clock
 * on another replica — is ignored rather than allowed to extend the lock.
 */
export function unlockLockout(
  failures: Date[],
  now: Date = new Date(),
): LockoutVerdict {
  const since = now.getTime() - LOCKOUT_WINDOW_MS;
  const recent = failures
    .map((date) => date.getTime())
    .filter((time) => time > since && time <= now.getTime());

  if (recent.length < FREE_ATTEMPTS) return { locked: false };

  const latest = Math.max(...recent);
  const until = latest + lockoutDelay(recent.length);

  return until > now.getTime()
    ? { locked: true, retryAfterMs: until - now.getTime() }
    : { locked: false };
}

/** "3 minutes", "1 minute", "45 seconds" — for the recipient's message. */
export function describeWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);

  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;

  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
