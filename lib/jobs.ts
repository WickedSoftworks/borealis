import { db } from "@/lib/db";
import { extractText } from "@/lib/extract";
import { search } from "@/lib/search";
import { storage } from "@/lib/storage";

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

async function expireSweep() {
  // Shares past their clock are refused by the guard already; this is
  // housekeeping so the dashboard does not accumulate dead rows forever.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  await db.share.updateMany({
    where: { expiresAt: { lt: new Date() }, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await db.shareAccess.deleteMany({ where: { createdAt: { lt: cutoff } } });
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
      case "EXPIRE_SWEEP":
        await expireSweep();
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
