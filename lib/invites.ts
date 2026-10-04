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
 * these are ~99-bit random strings, not passwords, so there is nothing to
 * brute-force and lookup must stay a single indexed query.
 */
export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 20;
/** The largest multiple of the alphabet a byte can hold; see below. */
const UNBIASED_LIMIT = 256 - (256 % CODE_ALPHABET.length);

/**
 * Twenty characters from a 31-letter alphabet with the look-alikes taken out
 * (no 0/O, 1/I/L) — about 99 bits — grouped in fives for reading aloud over a
 * call.
 *
 * A byte past the last whole multiple of 31 is thrown away rather than
 * folded in with `%`, which would make the first eight letters likelier
 * than the rest.
 */
export function generateInviteCode(): string {
  let body = "";

  while (body.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte >= UNBIASED_LIMIT) continue;
      body += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (body.length === CODE_LENGTH) break;
    }
  }

  return (body.match(/.{1,5}/g) ?? []).join("-");
}

export function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return x.length === y.length && timingSafeEqual(x, y);
}
