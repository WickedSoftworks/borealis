import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

/**
 * sha256 of stored bytes.
 *
 * Takes a stream rather than a Buffer on purpose. The files this hashes are the
 * ones the README promises to accept — multi-gigabyte — and reading one into
 * memory to hash it would put the whole upload on the heap. Nothing here
 * touches storage or the database, so it stays trivially testable.
 *
 * The digest covers the bytes AS STORED. For an end-to-end encrypted upload
 * that is the ciphertext, not the user's plaintext: it proves the object on
 * disk is the object that was accepted, and nothing more. Never present it to
 * a recipient as something they can check a decrypted file against.
 */
export async function hashStream(readable: Readable): Promise<string> {
  const hash = createHash("sha256");

  // Backpressure comes for free: the loop pulls one chunk at a time, so a 4 GB
  // object costs one chunk of memory rather than 4 GB.
  for await (const chunk of readable) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}
