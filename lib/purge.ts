/**
 * Trash retention — when a soft-deleted file's bytes actually go.
 *
 * Deleting a file sets `deletedAt` and revokes the links that carried it; the
 * bytes survive for a window afterwards so a misclick is recoverable. This file
 * owns the arithmetic of that window and nothing else: no database, no storage,
 * no clock beyond the one it is handed. The seam that acts on these decisions
 * is lib/trash.ts, and the job that runs them is PURGE_FILE in lib/jobs.ts.
 *
 * Retention is configurable because the operator owns the ceiling — a homelab
 * box with 40 GB free wants a shorter leash than a NAS with 8 TB, and roadmap
 * item 19 already counts the hard-coded audit-log window as a mistake worth not
 * repeating.
 */

/** Long enough to notice a mistake, short enough not to hoard a small disk. */
export const DEFAULT_RETENTION_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Read a retention window out of raw configuration.
 *
 * Separated from `retentionDays()` so the parsing is testable without touching
 * `process.env`. Anything unusable — unset, empty, not a number, zero, negative,
 * infinite — falls back to the default rather than throwing: an operator typo
 * must not be the reason a file host refuses to boot.
 *
 * Fractional days are accepted, which is mostly useful for testing. A very
 * large value effectively disables purging; that is the operator's disk to
 * fill, so it is allowed rather than clamped.
 */
export function parseRetentionDays(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_RETENTION_DAYS;

  const parsed = Number(raw.trim());

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_RETENTION_DAYS;
}

export function retentionDays(): number {
  return parseRetentionDays(process.env.TRASH_RETENTION_DAYS);
}

export function retentionMs(): number {
  return retentionDays() * MS_PER_DAY;
}

/**
 * Anything trashed at or before this instant is due to be purged.
 *
 * Expressed as a cutoff rather than as a predicate so the sweep can hand it
 * straight to Prisma as `deletedAt: { lte: purgeCutoff() }` — one indexed query
 * instead of loading the trash into memory to filter it.
 */
export function purgeCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - retentionMs());
}

/** When this file's bytes go. What the trash panel counts down to. */
export function purgeDueAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + retentionMs());
}

/**
 * Whether a file has served its time in the trash.
 *
 * A null `deletedAt` is a live file, never due — the purge job re-checks this
 * before deleting anything, because a restore may have landed between the sweep
 * enqueueing the job and the worker running it.
 */
export function isPurgeDue(
  deletedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (deletedAt === null) return false;

  return deletedAt.getTime() <= purgeCutoff(now).getTime();
}
