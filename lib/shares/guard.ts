import type { Share } from "@/lib/generated/prisma/client";
import { type CidrRange, ipMatchesList, parseCidrList } from "@/lib/request";
import { isExpired } from "./expiry";
import { UNLOCK_COOKIE_PREFIX, verifyUnlockToken } from "./password";

export type GuardFailure =
  | "NOT_FOUND"
  | "REVOKED"
  | "EXPIRED"
  | "ADDRESS_DENIED"
  | "DOWNLOAD_LIMIT"
  | "EGRESS_LIMIT"
  | "PASSWORD_REQUIRED"
  | "VIEW_ONLY";

export type GuardResult = { ok: true } | { ok: false; reason: GuardFailure };

export const GUARD_STATUS: Record<GuardFailure, number> = {
  NOT_FOUND: 404,
  REVOKED: 404,
  EXPIRED: 410,
  ADDRESS_DENIED: 403,
  DOWNLOAD_LIMIT: 410,
  EGRESS_LIMIT: 429,
  PASSWORD_REQUIRED: 401,
  VIEW_ONLY: 403,
};

/**
 * What the caller is about to do with the share.
 *
 *   metadata  render the share page: names, sizes, what is left of the caps
 *   preview   stream a file for viewing in the page; counts toward egress
 *   download  stream a file to be kept; also counts toward download count
 *
 * Preview remains available after the download count is exhausted, but its
 * bytes still consume the link's bandwidth budget.
 */
export type ShareIntent = "metadata" | "preview" | "download";

export type GuardOptions = {
  intent?: ShareIntent;
  /** Size of the file about to be served, for the egress pre-check. */
  bytes?: bigint;
  /** Raw cookie value proving the password gate was cleared. */
  unlockToken?: string;
  /**
   * The caller's address as `clientIp()` resolved it, or null when the proxy
   * configuration says none can be believed.
   */
  address?: string | null;
  /** Instance-wide refused ranges, from the admin settings. */
  deniedRanges?: CidrRange[];
};

/**
 * Whether an address may open a link.
 *
 * An allow list fails CLOSED on an unknown address — an operator who limited a
 * link to the office network did not mean "and anyone we cannot place" — while
 * the instance deny list fails open, since refusing everyone whose address is
 * unknown would take down every link on an instance that trusts no proxy.
 */
export function addressAllowed(
  allowedIps: string | null,
  address: string | null | undefined,
  deniedRanges: CidrRange[] = [],
): boolean {
  if (
    address &&
    deniedRanges.length > 0 &&
    ipMatchesList(address, deniedRanges)
  ) {
    return false;
  }

  if (!allowedIps?.trim()) return true;
  if (!address) return false;

  return ipMatchesList(address, parseCidrList(allowedIps).ranges);
}

/**
 * The single gate for all share access.
 *
 * Order matters and is deliberate: cheap, non-leaking checks first. Revoked and
 * missing shares both return 404 so a token can't be probed for existence, and
 * the password check comes LAST so that an expired or exhausted share doesn't
 * become a password oracle. The address check sits before the caps and the
 * password for the same reason: a caller on the wrong network learns only that
 * the link is not for them.
 */
export function guardShare(
  share: Share | null,
  options: GuardOptions = {},
): GuardResult {
  const intent = options.intent ?? "metadata";

  if (!share) return { ok: false, reason: "NOT_FOUND" };
  if (share.revokedAt) return { ok: false, reason: "REVOKED" };
  if (isExpired(share.expiresAt)) return { ok: false, reason: "EXPIRED" };

  if (
    !addressAllowed(share.allowedIps, options.address, options.deniedRanges)
  ) {
    return { ok: false, reason: "ADDRESS_DENIED" };
  }

  if (intent === "download") {
    if (share.viewOnly) {
      return { ok: false, reason: "VIEW_ONLY" };
    }

    if (
      share.maxDownloads !== null &&
      share.downloadCount >= share.maxDownloads
    ) {
      return { ok: false, reason: "DOWNLOAD_LIMIT" };
    }
  }

  if (intent !== "metadata" && share.egressLimitBytes !== null) {
    const projected = share.egressUsedBytes + (options.bytes ?? 0n);
    if (projected > share.egressLimitBytes) {
      return { ok: false, reason: "EGRESS_LIMIT" };
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

/** The unlock cookie's value from a raw `Cookie` header, if present. */
export function readUnlockCookie(
  cookieHeader: string | null,
  shareId: string,
): string | undefined {
  const name = `${unlockCookieName(shareId)}=`;
  const raw = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name))
    ?.slice(name.length);

  return raw ? decodeURIComponent(raw) : undefined;
}
