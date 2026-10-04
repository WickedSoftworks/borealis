/**
 * Downloads, counted in whole-file equivalents.
 *
 * A request costs its share of the file: the whole file is one download, a
 * range is the fraction of the file it covers. So a file fetched in two
 * halves is one download rather than none, a transfer resumed after a
 * dropped connection is one download across both attempts, and a request
 * abandoned partway costs what it took. Counting only whole-file requests let
 * anyone with a link and `curl --range` take as many full copies as they
 * liked without spending the cap at all.
 *
 * Pure, and free of the database, so client components can format and
 * compare with exactly the rules the server enforces.
 */

/** The counters are floats; this absorbs their rounding at the cap. */
const EPSILON = 1e-9;

/** Whole-file equivalents of `bytes` from a file of `size` bytes. */
export function downloadEquivalent(bytes: bigint, size: bigint): number {
  // An empty file has no fraction to take: asking for it is the download.
  if (size === 0n) return 1;

  return Number(bytes) / Number(size);
}

/**
 * Whether a cap leaves nothing to start another request on. A request may
 * begin while anything is left, so the last one can overshoot by less than a
 * download — the same allowance a whole-file count always made.
 */
export function downloadsExhausted(used: number, max: number | null): boolean {
  return max !== null && used >= max - EPSILON;
}

/** What is left of a cap, never negative. */
export function downloadsLeft(used: number, max: number): number {
  return Math.max(0, max - used);
}

/** "2", or "1.5" when a part-download is in the count. Never rounds up. */
export function formatDownloads(count: number): string {
  const tenths = Math.floor(count * 10 + EPSILON * 10) / 10;

  return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
}
