import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { purgeCutoff } from "@/lib/purge";
import { storage } from "@/lib/storage";

/**
 * The trash seam.
 *
 * Deleting a file is now two events separated by a retention window: it is
 * *trashed* (row kept, `deletedAt` set, every link carrying it revoked), and
 * later it is *purged* (bytes gone, row gone, irreversibly). Three call sites
 * need these — the delete endpoint, the restore endpoint, and the PURGE_FILE
 * job — so they are declared once here rather than in whichever of the three
 * happened to be written first.
 *
 * The window itself is lib/purge.ts, which knows nothing about storage or the
 * database and is unit-tested on its own.
 */

/** Enough of a File row to remove it. */
export type PurgeTarget = {
  id: string;
  storageKey: string;
  originalName: string;
  thumbnailKey?: string | null;
};

/**
 * Everything stored for a file besides its bytes: the thumbnail, and the
 * metadata sidecar tus keeps beside every upload — `<key>.json` on disk,
 * `<key>.info` in a bucket. Left behind, each would be an orphan for the
 * reconciliation sweep to report forever.
 */
function companionKeys(file: PurgeTarget): string[] {
  return [
    ...(file.thumbnailKey ? [file.thumbnailKey] : []),
    `${file.storageKey}.json`,
    `${file.storageKey}.info`,
  ];
}

/**
 * Whether a storage error means "the object is already gone".
 *
 * That is the goal state, not a failure: a duplicate PURGE_FILE job, a retry
 * after the bytes went but before the row did, or an operator who cleared the
 * volume by hand all arrive here. Anything else — a permissions problem, an S3
 * outage — must stay an error so the worker retries instead of orphaning bytes.
 */
function isAlreadyGone(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const candidate = error as {
    code?: string;
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };

  return (
    candidate.code === "ENOENT" ||
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

/**
 * Revoke every live share carrying this file, and report how many.
 *
 * Trashing revokes as hard-deleting always did: a link pointing at a file in
 * the trash would either 404 mid-download or come back to life on restore, and
 * neither is something to hand a recipient. Restoring does NOT un-revoke —
 * getting the file back is not the same as re-opening the links you had already
 * given out, and quietly reviving a link nobody re-checked is the opposite of
 * what this product promises.
 */
export async function revokeSharesCarrying(fileId: string): Promise<number> {
  const shareIds = (
    await db.shareItem.findMany({
      where: { fileId },
      select: { shareId: true },
    })
  ).map((item) => item.shareId);

  if (shareIds.length === 0) return 0;

  const result = await db.share.updateMany({
    where: { id: { in: shareIds }, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return result.count;
}

/**
 * Soft delete. Scoped to rows that are not already trashed, so a double-click
 * cannot restart the retention clock on something already counting down.
 *
 * Returns the instant the clock started, or null if the file was already in the
 * trash — the caller needs it to tell the operator when the bytes go.
 */
export async function trashFile(fileId: string): Promise<Date | null> {
  const deletedAt = new Date();

  const result = await db.file.updateMany({
    where: { id: fileId, deletedAt: null },
    data: { deletedAt },
  });

  return result.count > 0 ? deletedAt : null;
}

/**
 * Undo a trashing, for the owner only.
 *
 * Scoped to `ownerId` in the query rather than checked beforehand: there is no
 * window between the check and the write for the row to change hands, and a
 * restore aimed at someone else's file simply matches nothing.
 */
export async function restoreFile(
  fileId: string,
  ownerId: string,
): Promise<boolean> {
  const result = await db.file.updateMany({
    where: { id: fileId, ownerId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });

  return result.count > 0;
}

/**
 * Remove the bytes and the row, now. There is no recovering from this.
 *
 * `ShareItem` rows cascade away with the file and `ShareAccess.fileId` is
 * nulled, so the record of who fetched what outlives the file — which is the
 * same arrangement the hard delete had before there was a trash.
 *
 * By default a storage failure propagates, so the caller can retry rather than
 * delete the row and orphan the bytes forever. `orphanOnStorageFailure` opts
 * out of that for interactive callers, where refusing to remove a file because
 * its object store hiccuped is the worse answer.
 */
export async function purgeFile(
  file: PurgeTarget,
  { orphanOnStorageFailure = false }: { orphanOnStorageFailure?: boolean } = {},
): Promise<void> {
  try {
    await storage.delete(file.storageKey);
  } catch (error) {
    if (!isAlreadyGone(error)) {
      log.warn("storage.delete_failed", { key: file.storageKey, error });

      if (!orphanOnStorageFailure) throw error;
    }
  }

  // Best effort: the bytes that matter are gone, and these are small. A
  // failure here is left for the reconciliation report rather than failing a
  // purge that has already done its real work.
  for (const key of companionKeys(file)) {
    await storage.delete(key).catch(() => {});
  }

  await db.file.delete({ where: { id: file.id } });
}

/**
 * Files whose window has closed, oldest first.
 *
 * `deletedAt: { lte: cutoff }` excludes nulls in Prisma, so live files cannot
 * appear here however the cutoff moves. Capped because the sweep enqueues one
 * job per file and a trash emptied all at once should not put ten thousand rows
 * into the queue in a single tick — the next sweep picks up the remainder.
 */
export async function findDueForPurge(limit = 500): Promise<PurgeTarget[]> {
  return db.file.findMany({
    where: { deletedAt: { lte: purgeCutoff() } },
    orderBy: { deletedAt: "asc" },
    take: limit,
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      thumbnailKey: true,
    },
  });
}

/** Everything one account has in the trash, newest first. */
export async function trashedFiles(ownerId: string) {
  return db.file.findMany({
    where: { ownerId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    select: {
      id: true,
      originalName: true,
      size: true,
      mimeType: true,
      isEncrypted: true,
      deletedAt: true,
    },
  });
}

/**
 * Empty one account's trash immediately, skipping the retention window.
 *
 * Purged inline rather than queued. The alternative — enqueue and return — would
 * leave the files sitting in the panel for up to a poll interval after the
 * operator was told they were gone, and "empty the trash" is a promise about
 * now. Failures are collected per file so one unreachable object does not
 * strand the rest.
 */
export async function emptyTrash(
  ownerId: string,
): Promise<{ purged: number; failed: number }> {
  const files = await db.file.findMany({
    where: { ownerId, deletedAt: { not: null } },
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      thumbnailKey: true,
    },
  });

  let purged = 0;
  let failed = 0;

  for (const file of files) {
    try {
      await purgeFile(file);
      purged++;
    } catch {
      // Already logged by purgeFile. The row stays trashed, so the sweep will
      // come back to it once its window closes.
      failed++;
    }
  }

  return { purged, failed };
}
