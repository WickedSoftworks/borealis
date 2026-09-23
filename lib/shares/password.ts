import {
  createHmac,
  randomBytes,
  type ScryptOptions,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

/**
 * `promisify(scrypt)` drops the options overload, so wrap it explicitly rather
 * than casting at each call site.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

const KEY_LENGTH = 64;
/** Bumping this invalidates every existing hash, so treat it as a migration. */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

/**
 * Share passwords use Node's built-in scrypt rather than bcrypt, so the project
 * carries no native crypto dependency (better-auth already hashes *user*
 * passwords itself). Format: scrypt$N$r$p$salt$hash, all hex.
 */
export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);

  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifySharePassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, n, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");

  const derived = await scryptAsync(
    password,
    Buffer.from(saltHex, "hex"),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    },
  );

  return timingSafeEqual(derived, expected);
}

/**
 * Proof that a visitor cleared the password gate for one specific share.
 *
 * Scoped per share id and per password hash, so revoking or changing the
 * password invalidates every outstanding grant. Stored in a cookie; the secret
 * never leaves the server.
 */
export function signUnlockToken(
  shareId: string,
  passwordHash: string,
  expiresAt: number,
) {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is not set.");
  }

  const payload = `${shareId}.${expiresAt}`;
  const mac = createHmac("sha256", secret)
    .update(`${payload}.${passwordHash}`)
    .digest("hex");

  return `${payload}.${mac}`;
}

export function verifyUnlockToken(
  token: string,
  shareId: string,
  passwordHash: string,
  now = Date.now(),
): boolean {
  const parts = token.split(".");

  if (parts.length !== 3) return false;

  const [tokenShareId, expiresAtRaw] = parts;
  const expiresAt = Number(expiresAtRaw);

  if (
    tokenShareId !== shareId ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now
  ) {
    return false;
  }

  const expected = signUnlockToken(shareId, passwordHash, expiresAt);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

export const UNLOCK_COOKIE_PREFIX = "borealis_unlock_";
export const UNLOCK_TTL_MS = 60 * 60 * 1000;
