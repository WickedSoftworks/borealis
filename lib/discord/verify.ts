import { createPublicKey, verify } from "node:crypto";

// DER prefix that wraps a raw 32-byte Ed25519 key as SubjectPublicKeyInfo,
// the only form node's crypto accepts a bare public key in.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** How old a signed interaction may be before it is treated as a replay. */
const MAX_AGE_SECONDS = 5 * 60;

/**
 * Whether Discord sent this interaction.
 *
 * Discord signs `timestamp + body` with the application's Ed25519 key and
 * sends the signature in `X-Signature-Ed25519`. The Discord user id inside the
 * body is what the commands act on, so this check is the whole of the bot's
 * authentication: nothing in the body may be trusted until it passes. Discord
 * itself probes new endpoints with bad signatures and refuses to save one that
 * accepts them.
 */
export function verifyInteraction({
  publicKey,
  signature,
  timestamp,
  body,
  now = Date.now(),
}: {
  /** The application's public key, hex. */
  publicKey: string;
  signature: string | null;
  timestamp: string | null;
  body: string;
  now?: number;
}): boolean {
  if (!signature || !timestamp) return false;
  if (!/^[0-9a-f]{128}$/i.test(signature)) return false;
  if (!/^[0-9a-f]{64}$/i.test(publicKey)) return false;

  const sent = Number(timestamp);
  if (!Number.isFinite(sent) || Math.abs(now / 1000 - sent) > MAX_AGE_SECONDS) {
    return false;
  }

  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey, "hex")]),
      format: "der",
      type: "spki",
    });

    return verify(
      null,
      Buffer.from(timestamp + body),
      key,
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}
