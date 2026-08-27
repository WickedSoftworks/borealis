import { hashStream } from "@/lib/checksum";
import { db } from "@/lib/db";
import { downloadEmail, sendMail } from "@/lib/email";
import { extractText } from "@/lib/extract";
import { isPurgeDue } from "@/lib/purge";
import { search } from "@/lib/search";
import { storage } from "@/lib/storage";
import { findDueForPurge, purgeFile } from "@/lib/trash";

/**
 * The background worker.
 *
 * A polling loop over a table rather than Redis and a queue library: this has
 * to run unattended on one small box, and a second service to babysit is a
 * worse trade than a query every few seconds. Started from instrumentation.ts,
 * so it lives inside the same process as the app.
 */

const POLL_MS = 5_000;
const MAX_ATTEMPTS = 3;

let running = false;

async function extractTextJob(payload: { fileId: string }) {
  const file = await db.file.findUnique({
    where: { id: payload.fileId },
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
      originalName: true,
      isEncrypted: true,
    },
  });

  if (!file) return;

  // Encrypted uploads are ciphertext to the server. There is nothing to read.
  if (file.isEncrypted) {
    await db.fileText.upsert({
      where: { fileId: file.id },
      create: {
        fileId: file.id,
        status: "SKIPPED",
        error: "end-to-end encrypted; the server cannot read this file",
      },
      update: {
        status: "SKIPPED",
        error: "end-to-end encrypted; the server cannot read this file",
      },
    });
    return;
  }

  const buffer = await storage.download(file.storageKey);
  const result = await extractText(buffer, file.mimeType, file.originalName);

  if ("content" in result) {
    await search.index(file.id, result.content);
    return;
  }

  await db.fileText.upsert({
    where: { fileId: file.id },
    create: { fileId: file.id, status: "SKIPPED", error: result.skipped },
    update: { status: "SKIPPED", error: result.skipped, content: "" },
  });
}

/**
 * Hash the stored bytes of a file and record the digest.
 *
 * Note the absence of the `isEncrypted` guard that extractTextJob has above.
 * That is deliberate, not an oversight: extraction needs to read the plaintext
 * and cannot, but a checksum of ciphertext is still a checksum of the bytes
 * this server is responsible for keeping intact.
 */
async function checksumJob(payload: { fileId: string }) {
  const file = await db.file.findUnique({
    where: { id: payload.fileId },
    select: { id: true, storageKey: true, checksum: true },
  });

  if (!file) return;

  // Already hashed. Makes the job idempotent, so a retry after a partway
  // failure and a bulk backfill both cost nothing on rows that are done.
  if (file.checksum) return;

  const checksum = await hashStream(await storage.stream(file.storageKey));

  await db.file.update({ where: { id: file.id }, data: { checksum } });
}

async function expireSweep() {
  // Shares past their clock are refused by the guard already; this is
  // housekeeping so the dashboard does not accumulate dead rows forever.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  await db.share.updateMany({
    where: { expiresAt: { lt: new Date() }, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await db.shareAccess.deleteMany({ where: { createdAt: { lt: cutoff } } });

  /*
    Trash whose retention window has closed.

    Enqueued one job per file rather than deleted here, so that a single
    unreachable object cannot fail the whole sweep, each file gets its own
    backoff and FAILED state, and the sweep itself stays a cheap query. A file
    that is still queued from the previous sweep may be enqueued twice; the
    second job finds nothing and returns, which is cheaper than a query to
    prevent it.
  */
  const due = await findDueForPurge();

  if (due.length > 0) {
    await db.job.createMany({
      data: due.map((file) => ({
        type: "PURGE_FILE",
        payload: JSON.stringify({ fileId: file.id }),
      })),
    });
  }
}

/**
 * Remove one trashed file for good.
 *
 * Both guards below are the difference between a trash and a delayed delete.
 * The file may already be gone (a duplicate job, or an "empty trash" that beat
 * the sweep to it), and it may no longer be trashed at all — a restore can land
 * in the gap between the sweep enqueueing this job and the worker reaching it.
 * Re-reading `deletedAt` here rather than trusting the enqueue means the
 * retention window is evaluated against the row as it stands now.
 */
async function purgeFileJob(payload: { fileId: string }) {
  const file = await db.file.findUnique({
    where: { id: payload.fileId },
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      deletedAt: true,
    },
  });

  if (!file) return;
  if (!isPurgeDue(file.deletedAt)) return;

  await purgeFile(file);
}

async function runOne(): Promise<boolean> {
  const job = await db.job.findFirst({
    where: { status: "PENDING", runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
  });

  if (!job) return false;

  // Claim it. Scoped to PENDING so a second worker cannot take the same row.
  const claimed = await db.job.updateMany({
    where: { id: job.id, status: "PENDING" },
    data: { status: "RUNNING", attempts: { increment: 1 } },
  });

  if (claimed.count === 0) return true;

  try {
    const payload = JSON.parse(job.payload) as Record<string, string>;

    switch (job.type) {
      case "EXTRACT_TEXT":
        await extractTextJob(payload as { fileId: string });
        break;
      case "CHECKSUM":
        await checksumJob(payload as { fileId: string });
        break;
      case "EXPIRE_SWEEP":
        await expireSweep();
        break;
      case "PURGE_FILE":
        await purgeFileJob(payload as { fileId: string });
        break;
      default:
        // Unknown types are retired rather than retried forever.
        break;
    }

    await db.job.update({ where: { id: job.id }, data: { status: "DONE" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.attempts + 1;

    await db.job.update({
      where: { id: job.id },
      data: {
        status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
        lastError: message,
        // Back off so a failing job does not spin the loop.
        runAt: new Date(Date.now() + attempts * 30_000),
      },
    });

    console.warn(`job ${job.type} failed (attempt ${attempts}): ${message}`);
  }

  return true;
}

export function startWorker() {
  if (running) return;
  running = true;

  console.log("borealis: background worker started");

  const tick = async () => {
    try {
      // Drain rather than one-per-tick, so a burst of uploads indexes promptly.
      let worked = true;
      let guard = 0;

      while (worked && guard < 50) {
        worked = await runOne();
        guard++;
      }
    } catch (error) {
      console.warn("borealis: worker tick failed:", error);
    }

    setTimeout(tick, POLL_MS);
  };

  setTimeout(tick, POLL_MS);

  // One sweep per hour, enqueued rather than run inline so it shares the same
  // retry and logging path as everything else.
  setInterval(
    () => {
      db.job
        .create({ data: { type: "EXPIRE_SWEEP" } })
        .catch((error) => console.warn("could not enqueue sweep:", error));
    },
    60 * 60 * 1000,
  );
}
