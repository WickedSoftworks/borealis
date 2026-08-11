export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Time remaining, phrased as the share's own lifespan. Returns null for a share
 * that never expires so callers can say "forever" in their own words.
 */
export function formatRemaining(
  expiresAt: Date | string | null,
): string | null {
  if (!expiresAt) return null;

  const target =
    typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  const ms = target.getTime() - Date.now();

  if (ms <= 0) return "expired";

  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m left`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h left`;

  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d left`;

  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo left`;

  return `${Math.floor(days / 365)}y left`;
}
