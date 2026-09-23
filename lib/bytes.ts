/**
 * Byte sizes as an operator types them.
 *
 * Environment variables and the settings form both take "50GB", "512 MB",
 * "1.5TB", or a bare byte count, because a quota written as 53687091200 is a
 * quota nobody can check by eye. Binary units throughout (1 GB = 1024³ bytes),
 * matching what `formatBytes` prints, so a value round-trips through the
 * interface without drifting.
 */

const UNITS: Record<string, number> = {
  b: 0,
  k: 1,
  kb: 1,
  kib: 1,
  m: 2,
  mb: 2,
  mib: 2,
  g: 3,
  gb: 3,
  gib: 3,
  t: 4,
  tb: 4,
  tib: 4,
};

/**
 * Parse a size, or return null for anything unusable. Empty, "0", "none",
 * and "unlimited" are all null too — every size setting in this product uses
 * null to mean "no ceiling", and a zero-byte quota is never what someone meant.
 */
export function parseByteSize(raw: string | null | undefined): bigint | null {
  if (raw === null || raw === undefined) return null;

  const text = raw.trim().toLowerCase().replace(/_/g, "");
  if (!text || text === "none" || text === "unlimited") return null;

  const match = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/.exec(text);
  if (!match) return null;

  const [, amount, unit] = match;
  const power = UNITS[unit || "b"];
  if (power === undefined) return null;

  const value = Number(amount) * 1024 ** power;
  if (!Number.isFinite(value) || value < 1) return null;

  return BigInt(Math.floor(value));
}

/** The inverse, for prefilling a form: the largest unit that is exact-ish. */
export function describeByteSize(bytes: bigint | number | null): string {
  if (bytes === null) return "";

  const value = Number(bytes);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  let scaled = value;

  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit++;
  }

  const rounded = Math.round(scaled * 100) / 100;
  return `${rounded} ${units[unit]}`;
}
