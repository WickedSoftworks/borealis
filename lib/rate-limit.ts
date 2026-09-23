import { db } from "@/lib/db";
import { log } from "@/lib/log";

/**
 * Fixed-window rate limiting on the `RateLimit` table.
 *
 * In the database rather than in memory for the reason better-auth's own
 * limiter is pointed at the same table: a restart must not hand a brute-forcer
 * a fresh window, and two replicas must count against one budget. The cost is
 * a query per limited request, on endpoints that already do several.
 *
 * Keys are namespaced `borealis:` so they can never collide with the rows
 * better-auth writes for sign-in and sign-up.
 *
 * `RATE_LIMIT=off` disables every Borealis limit — for load tests, never for
 * an instance anyone else can reach. It does not touch the share unlock
 * lockout, which is a property of the share rather than of the traffic.
 */

export type RateRule = {
  /** Window length in seconds. */
  window: number;
  /** Requests allowed per window. */
  max: number;
};

export type RateDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

type Row = { count: number; lastRequest: bigint };

/**
 * The arithmetic, with no database. `lastRequest` holds the start of the
 * current window for Borealis rows.
 */
export function decide(
  row: Row | null,
  rule: RateRule,
  now: number,
): { decision: RateDecision; next: Row | null } {
  const windowMs = rule.window * 1000;

  if (!row || now - Number(row.lastRequest) >= windowMs) {
    return {
      decision: { allowed: true, remaining: rule.max - 1 },
      next: { count: 1, lastRequest: BigInt(now) },
    };
  }

  if (row.count >= rule.max) {
    return {
      decision: {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((Number(row.lastRequest) + windowMs - now) / 1000),
        ),
      },
      next: null,
    };
  }

  return {
    decision: { allowed: true, remaining: rule.max - row.count - 1 },
    next: { count: row.count + 1, lastRequest: row.lastRequest },
  };
}

export function rateLimitsEnabled(): boolean {
  return process.env.RATE_LIMIT?.toLowerCase() !== "off";
}

/**
 * Count one request against `key` and say whether it may proceed.
 *
 * The increment is a conditional `updateMany` rather than read-then-write, so
 * two concurrent requests arriving at `max - 1` cannot both get through. A
 * limiter failure (the database is down) fails open: refusing every sign-in
 * because the counter table hiccuped is the worse outage.
 */
export async function hit(
  key: string,
  rule: RateRule,
  attempt = 0,
): Promise<RateDecision> {
  if (!rateLimitsEnabled()) return { allowed: true, remaining: rule.max };

  const fullKey = `borealis:${key}`;
  const now = Date.now();

  try {
    const row = await db.rateLimit.findUnique({
      where: { key: fullKey },
      select: { count: true, lastRequest: true },
    });

    const { decision, next } = decide(row, rule, now);

    if (!decision.allowed || !next) return decision;

    if (next.count === 1) {
      // A new window. Upsert, because a concurrent first hit may have just
      // created the row — the loser simply restarts a window it shares.
      await db.rateLimit.upsert({
        where: { key: fullKey },
        create: { key: fullKey, count: 1, lastRequest: next.lastRequest },
        update: { count: 1, lastRequest: next.lastRequest },
      });
      return decision;
    }

    const claimed = await db.rateLimit.updateMany({
      where: {
        key: fullKey,
        lastRequest: next.lastRequest,
        count: { lt: rule.max },
      },
      data: { count: { increment: 1 } },
    });

    if (claimed.count === 0) {
      // Someone else took the last slot, or the window rolled over between
      // the read and the write. Either way, re-decide from the row as it is —
      // a bounded number of times, so a pathological race cannot recurse.
      if (attempt >= 3) {
        return { allowed: false, retryAfterSeconds: 1 };
      }
      return hit(key, rule, attempt + 1);
    }

    return decision;
  } catch (error) {
    log.warn("ratelimit.unavailable", { key, error });
    return { allowed: true, remaining: 0 };
  }
}

/** A 429 carrying `Retry-After`, in the shape the JSON routes already use. */
export function tooManyRequests(
  retryAfterSeconds: number,
  message = "Too many attempts. Wait a moment and try again.",
): Response {
  return Response.json(
    { error: message, retryAfter: retryAfterSeconds },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

/** Rows whose window closed a day ago or more. Run by the hourly sweep. */
export async function pruneRateLimits(olderThanMs = 24 * 60 * 60 * 1000) {
  await db.rateLimit.deleteMany({
    where: { lastRequest: { lt: BigInt(Date.now() - olderThanMs) } },
  });
}

/** Named limits, so the numbers live in one place rather than in each route. */
export const RULES = {
  /** Password attempts from one address, across every share. */
  unlockPerAddress: { window: 10 * 60, max: 20 },
  /** Invitation codes tried from one address. */
  invitePerAddress: { window: 15 * 60, max: 10 },
  /** Byte-serving requests on public links from one address. */
  shareDownloadPerAddress: { window: 60, max: 240 },
  /** New anonymous uploads into collection links from one address. */
  reverseUploadPerAddress: { window: 60 * 60, max: 100 },
  /** New uploads from one account. Generous: this is a guard, not a quota. */
  uploadPerUser: { window: 60, max: 120 },
  /** Test emails from the admin panel. */
  mailTest: { window: 60, max: 3 },
} satisfies Record<string, RateRule>;
