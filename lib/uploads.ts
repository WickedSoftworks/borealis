import type { Prisma } from "@/lib/generated/prisma/client";

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
  file: { id: string; isEncrypted: boolean },
  context: Record<string, string | null> = {},
) {
  const payload = JSON.stringify({ fileId: file.id, ...context });

  await tx.job.createMany({
    data: [
      // Queued for every upload, encrypted or not. The digest covers the stored
      // bytes, which for an E2E file means the ciphertext — that still detects a
      // truncated or corrupted object, and it keeps `checksum` populated on
      // every healthy row instead of doubling as "not computed yet".
      { type: "CHECKSUM", payload },

      // Encrypted payloads are opaque to the server — never queue extraction.
      ...(file.isEncrypted ? [] : [{ type: "EXTRACT_TEXT", payload }]),
    ],
  });
}
