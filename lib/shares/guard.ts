import type { Share } from "@/lib/generated/prisma/client";
import { isExpired } from "./expiry";
import { UNLOCK_COOKIE_PREFIX, verifyUnlockToken } from "./password";

export type GuardFailure =
  | "NOT_FOUND"
  | "REVOKED"
  | "EXPIRED"
  | "DOWNLOAD_LIMIT"
  | "EGRESS_LIMIT"
  | "PASSWORD_REQUIRED"
  | "VIEW_ONLY";

export type GuardResult = { ok: true } | { ok: false; reason: GuardFailure };

export const GUARD_STATUS: Record<GuardFailure, number> = {
  NOT_FOUND: 404,
  REVOKED: 404,
  EXPIRED: 410,
  DOWNLOAD_LIMIT: 410,
  EGRESS_LIMIT: 429,
  PASSWORD_REQUIRED: 401,
  VIEW_ONLY: 403,
};

export type GuardOptions = {
  /** Set for byte-serving requests; false when only reading share metadata. */
  isDownload?: boolean;
  /** Size of the file about to be served, for the egress pre-check. */
  bytes?: bigint;
  /** Raw cookie value proving the password gate was cleared. */
  unlockToken?: string;
};

/**
 * The single gate for all share access.
 *
 * Order matters and is deliberate: cheap, non-leaking checks first. Revoked and
 * missing shares both return 404 so a token can't be probed for existence, and
 * the password check comes LAST so that an expired or exhausted share doesn't
 * become a password oracle.
 */
export function guardShare(
  share: Share | null,
  options: GuardOptions = {},
): GuardResult {
  if (!share) return { ok: false, reason: "NOT_FOUND" };
  if (share.revokedAt) return { ok: false, reason: "REVOKED" };
  if (isExpired(share.expiresAt)) return { ok: false, reason: "EXPIRED" };

  if (options.isDownload) {
    if (share.viewOnly) {
      return { ok: false, reason: "VIEW_ONLY" };
    }

    if (
      share.maxDownloads !== null &&
      share.downloadCount >= share.maxDownloads
    ) {
      return { ok: false, reason: "DOWNLOAD_LIMIT" };
    }

    if (share.egressLimitBytes !== null) {
      const projected = share.egressUsedBytes + (options.bytes ?? 0n);

      if (projected > share.egressLimitBytes) {
        return { ok: false, reason: "EGRESS_LIMIT" };
      }
    }
  }

  if (share.passwordHash) {
    const token = options.unlockToken;

    if (!token || !verifyUnlockToken(token, share.id, share.passwordHash)) {
      return { ok: false, reason: "PASSWORD_REQUIRED" };
    }
  }

  return { ok: true };
}

export function unlockCookieName(shareId: string) {
  return `${UNLOCK_COOKIE_PREFIX}${shareId}`;
}
