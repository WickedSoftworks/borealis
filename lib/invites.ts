import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const ROLE_ROOT = "root";
export const ROLE_ADMIN = "admin";
export const ROLE_USER = "user";

/** The seeded root account. Never created through sign-up. */
export const ROOT_USER_ID = "0";

/** Cookie carrying a claimed code across an OAuth round trip. */
export const INVITE_COOKIE = "borealis_invite";
export const INVITE_COOKIE_TTL_S = 15 * 60;

/**
 * Codes are stored hashed. The plaintext is shown once at creation; a database
 * leak then yields no usable codes. SHA-256 without a salt is correct here —
 * these are 160-bit random strings, not passwords, so there is nothing to
 * brute-force and lookup must stay a single indexed query.
 */
export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

/** 32 chars of base32-ish, grouped for reading aloud over a call. */
export function generateInviteCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");

  return (body.match(/.{1,5}/g) ?? []).join("-");
}

export function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return x.length === y.length && timingSafeEqual(x, y);
}

export function isRoot(role: string | null | undefined): boolean {
  return role === ROLE_ROOT;
}

export function isAdmin(role: string | null | undefined): boolean {
  return role === ROLE_ROOT || role === ROLE_ADMIN;
}

/**
 * Who may mint what.
 *
 * Admins can invite users but not other admins: the trust model the operator
 * chose is that admins do not have control over each other, and minting a peer
 * admin is exactly that control. Only root widens the circle.
 */
export function canMintRole(
  minterRole: string | null | undefined,
  grantsRole: string,
): boolean {
  if (grantsRole === ROLE_ROOT) return false;
  if (grantsRole === ROLE_ADMIN) return isRoot(minterRole);

  return isAdmin(minterRole);
}
