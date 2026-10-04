import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Re-exported so server code keeps one import; client code takes these from
// lib/roles.ts, which does not drag `node:crypto` into the bundle.
export {
  canMintRole,
  isAdmin,
  isRoot,
  ROLE_ADMIN,
  ROLE_ROOT,
  ROLE_USER,
  ROOT_USER_ID,
} from "@/lib/roles";

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
