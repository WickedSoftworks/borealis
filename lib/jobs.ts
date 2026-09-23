import { hashStream } from "@/lib/checksum";
import type { JobType } from "@/lib/constants";
import { db } from "@/lib/db";
import { downloadEmail, sendMail } from "@/lib/email";
import { extractText } from "@/lib/extract";
import { claimPeriod } from "@/lib/lease";
import { log } from "@/lib/log";
import { isPurgeDue } from "@/lib/purge";
import { hit, pruneRateLimits } from "@/lib/rate-limit";
import { reconcileStorage } from "@/lib/reconcile";
import { scanJob } from "@/lib/scan";
import { search } from "@/lib/search";
import { getSettings } from "@/lib/settings";
import { storage } from "@/lib/storage";
import { thumbnailJob } from "@/lib/thumbnails";
import { findDueForPurge, purgeFile } from "@/lib/trash";
import { deleteExpiredUploads } from "@/lib/tus-store";

/**
 * The background worker.
 *
 * A polling loop over a table rather than Redis and a queue library: this has
 * to run unattended on one small box, and a second service to babysit is a
 * worse trade than a query every few seconds. Started from instrumentation.ts,
 * so it lives inside the same process as the app.
 *
 * Every process runs one. Jobs are claimed with a PENDING-scoped update, so a
 * job runs once however many workers poll; the periodic duties (the hourly
 * sweep, the daily reconciliation) are claimed through lib/lease.ts, so they
 * run once however many processes there are.
 */

const POLL_MS = 5_000;
export const MAX_ATTEMPTS = 3;
const SCHEDULER_TICK_MS = 60_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A RUNNING job older than this belonged to a process that died mid-job. */
const STUCK_AFTER_MS = 30 * 60 * 1000;

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
      size: true,
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

  const result = await extractText(() => storage.download(file.storageKey), {
    mimeType: file.mimeType,
    name: file.originalName,
    size: file.size,
  });

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

/**
 * Email a share's owner that it was downloaded.
 *
 * Re-reads the share rather than trusting the enqueue: the owner may have
 * turned notifications off, or revoked the link, in the seconds since. Limited
 * to ten messages per link per hour — a link being hammered is exactly when an
 * inbox should not be — and the email says so, pointing at the access log,
 * which records every download whether or not anyone was mailed about it.
 */
async function notifyDownloadJob(payload: {
  shareId: string;
  /** Null for a whole-link archive. */
  fileId: string | null;
  /** How many files the archive carried, when it was one. */
  archive?: number;
  ipAddress?: string | null;
  at?: string;
}) {
  const share = await db.share.findUnique({
    where: { id: payload.shareId },
    select: {
      id: true,
      token: true,
      name: true,
      notifyOnDownload: true,
      notifyEmail: true,
      maxDownloads: true,
      downloadCount: true,
      owner: { select: { email: true } },
    },
  });

  if (!share?.notifyOnDownload) return;

  const allowed = await hit(`notify:${share.id}`, { window: 60 * 60, max: 10 });

  if (!allowed.allowed) {
    log.info("notify.suppressed", { shareId: share.id });
    return;
  }

  const [file, settings] = await Promise.all([
    payload.fileId
      ? db.file.findUnique({
          where: { id: payload.fileId },
          select: { originalName: true, size: true },
        })
      : Promise.resolve(null),
    getSettings(),
  ]);

  const fileName =
    payload.fileId === null
      ? `every file, as one ZIP (${payload.archive ?? "several"} files)`
      : (file?.originalName ?? null);

  await sendMail({
    to: share.notifyEmail ?? share.owner.email,
    ...downloadEmail({
      instanceName: settings.instanceName,
      shareName: share.name,
      sharePath: `/s/${share.token}`,
      fileName,
      fileSize: file?.size ?? null,
      ipAddress: payload.ipAddress ?? null,
      at: payload.at ? new Date(payload.at) : new Date(),
      downloadsLeft:
        share.maxDownloads === null
          ? null
          : Math.max(0, share.maxDownloads - share.downloadCount),
    }),
  });
}

async function expireSweep() {
  const { auditRetentionDays } = await getSettings();

  // Shares past their clock are refused by the guard already; this is
  // housekeeping so the dashboard does not accumulate dead rows forever.
  await db.share.updateMany({
    where: { expiresAt: { lt: new Date() }, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  // The recipient audit trail keeps what the operator configured — 30 days
  // unless they said otherwise (AUDIT_RETENTION_DAYS, or the admin panel).
  const cutoff = new Date(Date.now() - auditRetentionDays * DAY_MS);
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

  // Uploads started and never finished. Only incomplete ones; see
  // lib/tus-store.ts for why a finished upload is never touched here.
  const expired = await deleteExpiredUploads();
  if (expired > 0) log.info("uploads.expired_removed", { count: expired });

  await pruneRateLimits();

  // Finished jobs are history nobody reads. Failed ones stay until an admin
  // retries or discards them — they are the only record of what went wrong.
  await db.job.deleteMany({
    where: {
      status: "DONE",
      updatedAt: { lt: new Date(Date.now() - 7 * DAY_MS) },
    },
  });

  await recoverStuckJobs();
}

/**
 * Jobs left RUNNING by a process that died mid-job go back in the queue, or to
 * FAILED if they have had their attempts. Without this a crash during a
 * checksum would leave that file unhashed forever and invisible to the admin
 * panel's failed-jobs list.
 */
async function recoverStuckJobs() {
  const stale = new Date(Date.now() - STUCK_AFTER_MS);

  await db.job.updateMany({
    where: {
      status: "RUNNING",
      updatedAt: { lt: stale },
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: {
      status: "FAILED",
      lastError: "worker stopped while running this job",
    },
  });

  await db.job.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: stale } },
    data: { status: "PENDING", runAt: new Date() },
  });
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
      thumbnailKey: true,
      deletedAt: true,
    },
  });

  if (!file) return;
  if (!isPurgeDue(file.deletedAt)) return;

  await purgeFile(file);
}

const HANDLERS: Record<JobType, (payload: never) => Promise<unknown>> = {
  EXTRACT_TEXT: extractTextJob,
  CHECKSUM: checksumJob,
  EXPIRE_SWEEP: expireSweep,
  NOTIFY_DOWNLOAD: notifyDownloadJob,
  PURGE_FILE: purgeFileJob,
  THUMBNAIL: thumbnailJob,
  SCAN_FILE: scanJob,
  RECONCILE_STORAGE: () => reconcileStorage(),
};

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

  const attempts = job.attempts + 1;
  const started = Date.now();

  try {
    const payload = JSON.parse(job.payload) as never;
    const handler = HANDLERS[job.type as JobType];

    if (handler) {
      await handler(payload);
    } else {
      // Unknown types are retired rather than retried forever — but loudly,
      // because a type nobody handles is a promise somebody made.
      log.warn("job.unknown_type", { id: job.id, type: job.type });
    }

    await db.job.update({ where: { id: job.id }, data: { status: "DONE" } });

    log.debug("job.done", {
      id: job.id,
      type: job.type,
      ms: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = attempts >= MAX_ATTEMPTS;

    await db.job.update({
      where: { id: job.id },
      data: {
        status: failed ? "FAILED" : "PENDING",
        lastError: message,
        // Back off so a failing job does not spin the loop.
        runAt: new Date(Date.now() + attempts * 30_000),
      },
    });

    (failed ? log.error : log.warn)("job.failed", {
      id: job.id,
      type: job.type,
      attempt: attempts,
      final: failed,
      error: message,
    });
  }

  return true;
}

/** The periodic duties, each claimed so exactly one process performs it. */
async function schedule() {
  if (await claimPeriod("schedule.expire-sweep", HOUR_MS)) {
    await db.job.create({ data: { type: "EXPIRE_SWEEP" } });
  }

  if (await claimPeriod("schedule.reconcile-storage", DAY_MS)) {
    await db.job.create({ data: { type: "RECONCILE_STORAGE" } });
  }
}

export function startWorker() {
  if (running) return;
  running = true;

  log.info("worker.started", { pollMs: POLL_MS });

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
      log.warn("worker.tick_failed", { error });
    }

    setTimeout(tick, POLL_MS);
  };

  setTimeout(tick, POLL_MS);

  const scheduler = () => {
    schedule().catch((error) => log.warn("worker.schedule_failed", { error }));
  };

  // Soon after boot, so an instance that was down across a sweep catches up,
  // then every minute — the leases decide whether anything is actually due.
  setTimeout(scheduler, 15_000);
  setInterval(scheduler, SCHEDULER_TICK_MS);
}

// ------------------------------------------------------------ Admin view --

export type JobCounts = Record<"PENDING" | "RUNNING" | "FAILED", number>;

export async function jobCounts(): Promise<JobCounts> {
  const groups = await db.job.groupBy({
    by: ["status"],
    where: { status: { in: ["PENDING", "RUNNING", "FAILED"] } },
    _count: true,
  });

  const counts: JobCounts = { PENDING: 0, RUNNING: 0, FAILED: 0 };

  for (const group of groups) {
    counts[group.status as keyof JobCounts] = group._count;
  }

  return counts;
}

/** Put a FAILED job back in the queue with a fresh set of attempts. */
export async function retryJob(id: string): Promise<boolean> {
  const result = await db.job.updateMany({
    where: { id, status: "FAILED" },
    data: { status: "PENDING", attempts: 0, runAt: new Date() },
  });

  return result.count > 0;
}

/** Drop a FAILED job for good — for work that no longer matters. */
export async function discardJob(id: string): Promise<boolean> {
  const result = await db.job.deleteMany({ where: { id, status: "FAILED" } });
  return result.count > 0;
}
