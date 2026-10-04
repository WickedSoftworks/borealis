import type { JobType } from "@/lib/constants";
import type { Prisma } from "@/lib/generated/prisma/client";
import { scannerConfigured } from "@/lib/scan";
import { canThumbnail } from "@/lib/thumbnails";

/**
 * The single seam for "a file finished uploading".
 *
 * Both tus mounts — lib/tus.ts for authenticated uploads and lib/tus-reverse.ts
 * for anonymous ones into a reverse share — land here, so post-upload work is
 * declared once instead of drifting between two copies.
 *
 * Everything is queued rather than run inline. The tus handler that calls this
 * is still holding the client's final PATCH open, and hashing a multi-gigabyte
 * file there would turn a completed upload into a client timeout. The worker in
 * lib/jobs.ts already has retries, backoff, and a FAILED state; a second
 * mechanism for the same event would have none of them.
 *
 * Takes a transaction client so the jobs commit together with the File row they
 * point at — the worker can never observe a job whose file does not exist yet.
 */
export async function enqueuePostUploadJobs(
  tx: Prisma.TransactionClient,
  file: { id: string; isEncrypted: boolean; mimeType: string },
  context: Record<string, string | null> = {},
) {
  const payload = JSON.stringify({ fileId: file.id, ...context });

  const types: JobType[] = [];

  // First, when a scanner exists: public links withhold the file until it
  // has a verdict (lib/shares/withheld.ts), so this is the job a recipient is
  // waiting on — and the one to finish before parsers open the file. Queued
  // for encrypted files too, so the row records WHY it was not scanned
  // rather than looking like it was forgotten.
  if (scannerConfigured()) types.push("SCAN_FILE");

  // Queued for every upload, encrypted or not. The digest covers the stored
  // bytes, which for an E2E file means the ciphertext — that still detects a
  // truncated or corrupted object, and it keeps `checksum` populated on
  // every healthy row instead of doubling as "not computed yet".
  types.push("CHECKSUM");

  // Encrypted payloads are opaque to the server — never queue anything that
  // would have to read them.
  if (!file.isEncrypted) {
    types.push("EXTRACT_TEXT");
    if (canThumbnail(file.mimeType)) types.push("THUMBNAIL");
  }

  await tx.job.createMany({
    data: types.map((type) => ({ type, payload })),
  });
}
