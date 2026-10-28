/**
 * When a live link deserves the owner's eye.
 *
 * Two reasons, both about containment rather than popularity: someone is
 * guessing its password, or it is about to stop working because a limit is
 * nearly spent. Expiry alone is not one — a link running out of time is doing
 * exactly what it was told.
 *
 * Pure: no database. The query that finds guessing is in `guessing.ts`.
 */

/** Wrong passwords within the lockout window that read as guessing, not a typo. */
export const GUESSING_THRESHOLD = 3;

/** Share of a transfer cap after which the link is "near its limit". */
const EGRESS_NEAR = 0.8;

export type LimitState = {
  maxDownloads: number | null;
  downloadCount: number;
  egressLimitBytes: number | null;
  egressUsedBytes: number;
};

/**
 * Whether one more ordinary use could end the link: its next download is the
 * last, or most of its transfer cap is gone. A single-download link is not
 * "near" anything before its one download — that is its whole design.
 */
export function nearLimit(share: LimitState): boolean {
  if (
    share.maxDownloads !== null &&
    share.maxDownloads > 1 &&
    share.downloadCount >= share.maxDownloads - 1 &&
    share.downloadCount < share.maxDownloads
  ) {
    return true;
  }

  if (
    share.egressLimitBytes !== null &&
    share.egressLimitBytes > 0 &&
    share.egressUsedBytes >= share.egressLimitBytes * EGRESS_NEAR &&
    share.egressUsedBytes < share.egressLimitBytes
  ) {
    return true;
  }

  return false;
}
