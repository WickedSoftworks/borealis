import fs from "node:fs/promises";
import path from "node:path";
import { FileStore } from "@tus/file-store";
import { S3Store } from "@tus/s3-store";
import type { DataStore } from "@tus/server";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { classifyKey } from "@/lib/reconcile";

/**
 * The tus datastore, shared by both mounts.
 *
 * Uploads that are started and never finished used to stay on disk forever: a
 * stranger who began a 2 GB upload through a collection link and closed the
 * tab left 2 GB behind, with no database row and nothing that would ever
 * remove it. The store now carries an expiration, which does two things —
 * tus refuses to resume an upload past it (and says so in `Upload-Expires`),
 * and `deleteExpiredUploads()`, run by the hourly sweep, removes the bytes.
 * Only INCOMPLETE uploads expire; a finished one is a file and belongs to the
 * database from then on.
 *
 * `UPLOAD_EXPIRY_HOURS` sets the window (default 24). Long enough to resume
 * after a dropped connection or a laptop lid closing overnight.
 *
 * DO NOT call `FileStore.deleteExpired()`. @tus/file-store writes each
 * upload's `<id>.json` once, at creation, with `offset: 0`, and never updates
 * it — the live offset is read from the file's size on disk. Its
 * `deleteExpired()` compares the stale stored offset against the size, so
 * every upload older than the window looks incomplete, and it deletes
 * finished files. `sweepAbandonedLocal` below is the replacement: it stats
 * the real file, and it never touches anything a `File` row points at.
 * (S3Store's version is sound — it works from the bucket's list of
 * in-progress multipart uploads, which a finished upload is not in.)
 */

const DEFAULT_EXPIRY_HOURS = 24;

export function uploadExpiryMs(): number {
  const hours = Number(process.env.UPLOAD_EXPIRY_HOURS);
  const effective =
    Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_EXPIRY_HOURS;

  return effective * 60 * 60 * 1000;
}

export function createTusStore(): DataStore {
  const expirationPeriodInMilliseconds = uploadExpiryMs();

  if (process.env.STORAGE_DRIVER === "s3") {
    const bucket = process.env.S3_BUCKET;

    if (!bucket) {
      throw new Error('STORAGE_DRIVER is "s3" but S3_BUCKET is not set.');
    }

    return new S3Store({
      expirationPeriodInMilliseconds,
      s3ClientConfig: {
        bucket,
        region: process.env.S3_REGION ?? "us-east-1",
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
        credentials:
          process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.S3_ACCESS_KEY_ID,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
              }
            : undefined,
      },
    });
  }

  return new FileStore({
    directory: process.env.STORAGE_PATH ?? "./uploads",
    expirationPeriodInMilliseconds,
  });
}

/** Metadata values arrive base64-encoded per the tus spec; @tus/server decodes them. */
export function metaString(
  metadata: Record<string, string | null> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type StoredInfo = { size?: number; creation_date?: string };

/**
 * Whether one local upload is abandoned: declared a size, has fewer bytes than
 * that on disk, is older than the window, and is not a file anyone recorded.
 * Every condition must hold. Pure, so each refusal is tested on its own.
 */
export function isAbandoned({
  info,
  bytesOnDisk,
  recorded,
  now,
  expiryMs,
}: {
  info: StoredInfo;
  /** Null when the data file is missing. */
  bytesOnDisk: number | null;
  recorded: boolean;
  now: number;
  expiryMs: number;
}): boolean {
  if (recorded) return false;
  if (typeof info.size !== "number") return false;
  if (!info.creation_date) return false;

  const created = new Date(info.creation_date).getTime();
  if (!Number.isFinite(created) || now - created < expiryMs) return false;

  // A sidecar whose data file is already gone is litter either way.
  if (bytesOnDisk === null) return true;

  return bytesOnDisk < info.size;
}

/** The local sweep; see the header for why this is not tus's own. */
async function sweepAbandonedLocal(
  directory: string,
  expiryMs: number,
): Promise<number> {
  let names: string[];

  try {
    names = await fs.readdir(directory);
  } catch {
    return 0;
  }

  let removed = 0;
  const now = Date.now();

  for (const name of names) {
    if (!name.endsWith(".json")) continue;

    const id = name.slice(0, -".json".length);
    const kind = classifyKey(id);

    // Only uploads Borealis named. Anything else in the directory is not ours.
    if (kind.kind !== "upload" || kind.base !== id) continue;

    let info: StoredInfo;

    try {
      info = JSON.parse(
        await fs.readFile(
          path.join(/*turbopackIgnore: true*/ directory, name),
          "utf8",
        ),
      );
    } catch {
      continue;
    }

    let bytesOnDisk: number | null = null;

    try {
      bytesOnDisk = (
        await fs.stat(path.join(/*turbopackIgnore: true*/ directory, id))
      ).size;
    } catch {
      bytesOnDisk = null;
    }

    const recorded = (await db.file.count({ where: { storageKey: id } })) > 0;

    if (!isAbandoned({ info, bytesOnDisk, recorded, now, expiryMs })) continue;

    await fs.rm(path.join(/*turbopackIgnore: true*/ directory, id), {
      force: true,
    });
    await fs.rm(path.join(/*turbopackIgnore: true*/ directory, name), {
      force: true,
    });
    removed++;

    log.info("uploads.abandoned_removed", {
      id,
      declared: info.size,
      received: bytesOnDisk,
    });
  }

  return removed;
}

/**
 * Remove every abandoned upload's bytes. Returns how many went.
 *
 * Both mounts write to the same directory or bucket, so one sweep covers both.
 */
export async function deleteExpiredUploads(): Promise<number> {
  if (process.env.STORAGE_DRIVER === "s3") {
    return (createTusStore() as S3Store).deleteExpired();
  }

  return sweepAbandonedLocal(
    // turbopackIgnore: a runtime directory, not a source path. Without the
    // hint the build's file tracer assumes it could be anything and copies
    // the whole project into the standalone output.
    path.resolve(
      /*turbopackIgnore: true*/ process.env.STORAGE_PATH ?? "./uploads",
    ),
    uploadExpiryMs(),
  );
}
