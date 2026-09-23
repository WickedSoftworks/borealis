import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { storage } from "@/lib/storage";
import type { StoredObject } from "@/lib/storage/provider";

/**
 * Storage reconciliation: objects in the store that no `File` row points at.
 *
 * Abandoned uploads are handled elsewhere, safely and automatically — tus
 * expires INCOMPLETE uploads itself (lib/tus-store.ts). What is left for this
 * sweep is rarer and more dangerous to guess about: completed objects with no
 * row, from a crash between the bytes landing and the row committing, a failed
 * account deletion, or a purge whose storage call failed.
 *
 * It REPORTS by default and deletes only when told to. The same comparison
 * that finds a genuine orphan also "finds" every file uploaded after a
 * database backup was taken, the moment someone restores that backup — and a
 * sweep that deleted those would turn a routine restore into data loss a week
 * later. So the finding is recorded, shown in the admin panel with a button,
 * and removed automatically only when `RECONCILE_DELETE=true`.
 *
 * Only keys that look like Borealis wrote them are ever considered. STORAGE_PATH
 * may be a directory with other things in it; those are not ours to judge.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `<ownerId>_<uuid>` and `reverse_<uuid>`, plus tus's sidecar suffixes. */
const UPLOAD_KEY = new RegExp(
  `^([A-Za-z0-9-]+_${UUID})(\\.json|\\.info|\\.part)?$`,
);
const THUMBNAIL_KEY = /^thumb_[A-Za-z0-9]+\.webp$/;

/** Old enough that nothing in flight could still claim it. */
export const MIN_ORPHAN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ClassifiedKey =
  | { kind: "upload"; base: string }
  | { kind: "thumbnail" }
  | { kind: "foreign" };

/** Which of our naming schemes a key belongs to, if any. Pure. */
export function classifyKey(key: string): ClassifiedKey {
  const upload = UPLOAD_KEY.exec(key);
  if (upload) return { kind: "upload", base: upload[1] };
  if (THUMBNAIL_KEY.test(key)) return { kind: "thumbnail" };
  return { kind: "foreign" };
}

export type ReconcileReport = {
  at: string;
  scanned: number;
  orphans: number;
  orphanBytes: number;
  deleted: number;
  failed: number;
  /** A few examples, for the operator to spot-check before deleting. */
  sample: string[];
};

const REPORT_KEY = "reconcile.lastReport";

async function referencedAmong(batch: StoredObject[]): Promise<Set<string>> {
  const uploadBases = new Set<string>();
  const thumbnails: string[] = [];

  for (const object of batch) {
    const kind = classifyKey(object.key);
    if (kind.kind === "upload") uploadBases.add(kind.base);
    if (kind.kind === "thumbnail") thumbnails.push(object.key);
  }

  const rows = await db.file.findMany({
    where: {
      OR: [
        { storageKey: { in: [...uploadBases] } },
        { thumbnailKey: { in: thumbnails } },
      ],
    },
    select: { storageKey: true, thumbnailKey: true },
  });

  const referenced = new Set<string>();

  for (const row of rows) {
    referenced.add(row.storageKey);
    if (row.thumbnailKey) referenced.add(row.thumbnailKey);
  }

  return referenced;
}

/**
 * Walk the store, find orphans, and delete them if asked.
 *
 * Checked in batches against the database, so memory stays flat however large
 * the bucket is.
 */
export async function reconcileStorage({
  remove = process.env.RECONCILE_DELETE === "true",
  now = Date.now(),
}: {
  remove?: boolean;
  now?: number;
} = {}): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    at: new Date(now).toISOString(),
    scanned: 0,
    orphans: 0,
    orphanBytes: 0,
    deleted: 0,
    failed: 0,
    sample: [],
  };

  let batch: StoredObject[] = [];

  const flush = async () => {
    if (batch.length === 0) return;

    const referenced = await referencedAmong(batch);

    for (const object of batch) {
      const kind = classifyKey(object.key);
      const claimed =
        kind.kind === "upload"
          ? referenced.has(kind.base)
          : referenced.has(object.key);

      if (claimed) continue;

      report.orphans++;
      report.orphanBytes += object.size;
      if (report.sample.length < 10) report.sample.push(object.key);

      if (remove) {
        try {
          await storage.delete(object.key);
          report.deleted++;
        } catch (error) {
          report.failed++;
          log.warn("reconcile.delete_failed", { key: object.key, error });
        }
      }
    }

    batch = [];
  };

  for await (const object of storage.list()) {
    report.scanned++;

    if (classifyKey(object.key).kind === "foreign") continue;
    if (now - object.modifiedAt.getTime() < MIN_ORPHAN_AGE_MS) continue;

    batch.push(object);
    if (batch.length >= 500) await flush();
  }

  await flush();

  await db.appSetting.upsert({
    where: { key: REPORT_KEY },
    create: { key: REPORT_KEY, value: JSON.stringify(report) },
    update: { value: JSON.stringify(report) },
  });

  log.info("reconcile.done", {
    scanned: report.scanned,
    orphans: report.orphans,
    orphanBytes: report.orphanBytes,
    deleted: report.deleted,
    failed: report.failed,
  });

  return report;
}

export async function lastReconcileReport(): Promise<ReconcileReport | null> {
  const row = await db.appSetting.findUnique({ where: { key: REPORT_KEY } });

  if (!row) return null;

  try {
    return JSON.parse(row.value) as ReconcileReport;
  } catch {
    return null;
  }
}
