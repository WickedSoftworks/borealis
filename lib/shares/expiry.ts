/**
 * Share expiry.
 *
 * Every preset collapses to a single nullable `expiresAt`, where null means
 * "forever". The expiry is always computed on the server — a client-supplied
 * timestamp would let anyone mint a never-expiring share.
 */

export const EXPIRY_PRESETS = [
  { id: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { id: "1w", label: "1 week", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "1m", label: "1 month", ms: 30 * 24 * 60 * 60 * 1000 },
  { id: "1y", label: "1 year", ms: 365 * 24 * 60 * 60 * 1000 },
  { id: "5y", label: "5 years", ms: 5 * 365 * 24 * 60 * 60 * 1000 },
  { id: "forever", label: "Forever", ms: null },
] as const;

export type ExpiryPresetId = (typeof EXPIRY_PRESETS)[number]["id"];

export type ExpiryInput =
  | { mode: "preset"; preset: ExpiryPresetId }
  /** A custom duration, e.g. { value: 36, unit: "hours" }. */
  | {
      mode: "duration";
      value: number;
      unit: "minutes" | "hours" | "days" | "weeks";
    }
  /** An explicit "until" date, as an ISO string. */
  | { mode: "until"; date: string };

const UNIT_MS = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
} as const;

/** Longest a custom duration may be, so "custom" can't smuggle in a 500-year share. */
const MAX_DURATION_MS = 100 * 365 * 24 * 60 * 60 * 1000;

export function resolveExpiry(
  input: ExpiryInput,
  now = new Date(),
): Date | null {
  switch (input.mode) {
    case "preset": {
      const preset = EXPIRY_PRESETS.find((p) => p.id === input.preset);

      if (!preset) {
        throw new Error(`Unknown expiry preset: ${input.preset}`);
      }

      return preset.ms === null ? null : new Date(now.getTime() + preset.ms);
    }

    case "duration": {
      if (!Number.isFinite(input.value) || input.value <= 0) {
        throw new Error("Custom duration must be a positive number.");
      }

      const ms = input.value * UNIT_MS[input.unit];

      if (ms > MAX_DURATION_MS) {
        throw new Error("Custom duration is too long.");
      }

      return new Date(now.getTime() + ms);
    }

    case "until": {
      const date = new Date(input.date);

      if (Number.isNaN(date.getTime())) {
        throw new Error("Invalid expiry date.");
      }

      if (date.getTime() <= now.getTime()) {
        throw new Error("Expiry date must be in the future.");
      }

      return date;
    }
  }
}

export function isExpired(expiresAt: Date | null, now = new Date()): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}
