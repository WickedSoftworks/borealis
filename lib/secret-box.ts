import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Encryption for secrets kept in the database — the SMTP password, today.
 *
 * AES-256-GCM under a key derived from BETTER_AUTH_SECRET, so a copy of the
 * database alone does not yield the mail account's password. It is not
 * protection against someone who holds both the database and the environment;
 * nothing inside one process can be. Rotating BETTER_AUTH_SECRET makes stored
 * secrets unreadable, which `open` reports as null so the caller falls back to
 * the environment rather than failing to boot.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */

const VERSION = "v1";

function key(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is not set.");
  }

  return Buffer.from(
    hkdfSync("sha256", secret, "borealis", "settings-secret-box", 32),
  );
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

export function open(sealed: string): string | null {
  const [version, iv, tag, body] = sealed.split(".");

  if (version !== VERSION || !iv || !tag || body === undefined) return null;

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
