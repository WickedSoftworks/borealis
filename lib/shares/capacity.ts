import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Share } from "@/lib/generated/prisma/client";
import { log } from "@/lib/log";

const HEARTBEAT_MS = 60_000;
const STALE_MS = 24 * 60 * 60_000;
const heartbeats = new Map<string, ReturnType<typeof setInterval>>();

function startHeartbeat(id: string): void {
  const timer = setInterval(() => {
    void db.shareTransfer
      .updateMany({ where: { id }, data: { updatedAt: new Date() } })
      .catch((error) =>
        log.warn("share.transfer_heartbeat_failed", { id, error }),
      );
  }, HEARTBEAT_MS);
  timer.unref();
  heartbeats.set(id, timer);
}

function stopHeartbeat(id: string): void {
  const timer = heartbeats.get(id);
  if (timer) clearInterval(timer);
  heartbeats.delete(id);
}

/** Atomically claim projected egress and, for whole downloads, one slot. */
export async function reserveShareCapacity(
  share: Share,
  bytes: bigint,
  countDownload: boolean,
): Promise<string | null> {
  if (bytes < 0n) return null;
  if (countDownload && share.viewOnly) return null;
  if (
    countDownload &&
    share.maxDownloads !== null &&
    share.downloadCount >= share.maxDownloads
  )
    return null;
  if (share.egressLimitBytes !== null && bytes > share.egressLimitBytes)
    return null;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const id = randomUUID();
      const admitted = await db.$transaction(
        async (tx) => {
          const result = await tx.share.updateMany({
            where: {
              id: share.id,
              type: "SEND",
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              maxDownloads: share.maxDownloads,
              egressLimitBytes: share.egressLimitBytes,
              ...(countDownload ? { viewOnly: false } : {}),
              ...(countDownload && share.maxDownloads !== null
                ? { downloadCount: { lt: share.maxDownloads } }
                : {}),
              ...(share.egressLimitBytes !== null
                ? { egressUsedBytes: { lte: share.egressLimitBytes - bytes } }
                : {}),
            },
            data: {
              egressUsedBytes: { increment: bytes },
              ...(countDownload ? { downloadCount: { increment: 1 } } : {}),
            },
          });
          if (result.count !== 1) return false;
          await tx.shareTransfer.create({
            data: {
              id,
              shareId: share.id,
              reservedBytes: bytes,
              countDownload,
            },
          });
          return true;
        },
        { isolationLevel: "Serializable" },
      );
      if (!admitted) return null;
      startHeartbeat(id);
      return id;
    } catch (error) {
      if ((error as { code?: string }).code !== "P2034" || attempt === 3)
        throw error;
    }
  }
  throw new Error("Could not reserve share capacity");
}

/** Reconcile one completed or cancelled response exactly once. */
export async function reconcileShareCapacity(
  id: string,
  served: bigint,
  releaseDownload = false,
): Promise<void> {
  stopHeartbeat(id);
  await db.$transaction(async (tx) => {
    const transfer = await tx.shareTransfer.findUnique({ where: { id } });
    if (!transfer) return;
    if (served > transfer.reservedBytes) {
      throw new Error("Share stream exceeded its reserved bytes");
    }
    const deleted = await tx.shareTransfer.deleteMany({ where: { id } });
    if (deleted.count !== 1) return;
    await tx.share.update({
      where: { id: transfer.shareId },
      data: {
        egressUsedBytes: { decrement: transfer.reservedBytes - served },
        ...(releaseDownload ? { downloadCount: { decrement: 1 } } : {}),
      },
    });
  });
}

/** Finalize dead responses at their full reservation, preserving the ceiling. */
export async function recoverStaleShareTransfers(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await db.shareTransfer.findMany({
    where: { updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  let recovered = 0;
  for (const { id } of stale) {
    await db.$transaction(async (tx) => {
      const transfer = await tx.shareTransfer.findUnique({ where: { id } });
      if (!transfer || transfer.updatedAt >= cutoff) return;
      const deleted = await tx.shareTransfer.deleteMany({
        where: { id, updatedAt: { lt: cutoff } },
      });
      if (deleted.count !== 1) return;
      // The process died before reporting its last byte count. Charging the
      // full claim is conservative; refunding it would allow repeated crashes
      // to bypass the egress and download ceilings.
      recovered++;
    });
  }
  if (recovered) log.warn("share.stale_transfers_finalized", { recovered });
  return recovered;
}
