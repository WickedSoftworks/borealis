/**
 * Transfer arithmetic for the upload list: how fast, and how long left.
 *
 * Pure so it can be tested without a network. Speed is an exponentially
 * weighted average rather than the last sample, because tus reports progress
 * in bursts as each chunk lands and a raw rate swings between zero and
 * several times the real figure — an ETA that jumps from "2 s" to "3 h" is
 * worse than none.
 */

export type SpeedState = {
  /** Bytes per second, smoothed. Null until there is a second sample. */
  rate: number | null;
  lastBytes: number;
  lastAt: number;
};

const SMOOTHING = 0.3;

export function startSpeed(now: number, bytes = 0): SpeedState {
  return { rate: null, lastBytes: bytes, lastAt: now };
}

export function sampleSpeed(
  state: SpeedState,
  bytes: number,
  now: number,
): SpeedState {
  const elapsed = (now - state.lastAt) / 1000;

  // Too close together to measure anything; keep accumulating.
  if (elapsed < 0.25) return state;

  const instant = Math.max(0, bytes - state.lastBytes) / elapsed;
  const rate =
    state.rate === null
      ? instant
      : SMOOTHING * instant + (1 - SMOOTHING) * state.rate;

  return { rate, lastBytes: bytes, lastAt: now };
}

/** Seconds remaining, or null when there is no rate to divide by yet. */
export function remainingSeconds(
  state: SpeedState,
  sent: number,
  total: number,
): number | null {
  if (state.rate === null || state.rate < 1) return null;
  return Math.max(0, (total - sent) / state.rate);
}

export function formatRate(bytesPerSecond: number): string {
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = bytesPerSecond;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return "a moment";
  if (seconds < 60) return `${Math.ceil(seconds)} s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${Math.ceil(seconds % 60)} s`;

  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/**
 * The reason a tus request failed, in the server's own words when it gave
 * some. tus-js-client wraps everything in "tus: unexpected response while
 * creating upload, originated from request (method: POST, url: …, response
 * code: 413, response text: …)", which is accurate and unreadable.
 */
export function uploadErrorMessage(error: unknown): string {
  const detailed = error as {
    originalResponse?: { getStatus(): number; getBody(): string } | null;
    message?: string;
  };

  const response = detailed?.originalResponse;
  const body = response?.getBody()?.trim();

  if (response && body) return body;

  if (response?.getStatus() === 401) {
    return "You were signed out. Sign in again and choose the file again to resume.";
  }

  return detailed?.message?.replace(/^tus: /, "") ?? "Upload failed.";
}
