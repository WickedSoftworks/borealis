import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { releaseUpload, reserveUpload } from "@/lib/quota";
import { storage } from "@/lib/storage";
import { enqueuePostUploadJobs } from "@/lib/uploads";

export type StoredFile = { fileId: string };
export type StoreRefusal = { refused: string };

/**
 * Store bytes the server already holds as a file in someone's vault — a
 * Discord attachment, for one — under the same rules a browser upload meets.
 *
 * The browser path is tus (lib/tus.ts); this is its server-side twin, in the
 * same order: reserve against the quota before a byte is written, write,
 * then create the row and queue the post-upload jobs in one transaction so
 * the worker never sees a job for a file that does not exist. The key has
 * tus's shape, `<owner>_<uuid>`, so nothing downstream can tell the
 * difference.
 *
 * Takes a whole Buffer, so callers must bound the size first.
 */
export async function storeFile({
  ownerId,
  name,
  mimeType,
  data,
}: {
  ownerId: string;
  name: string;
  mimeType: string;
  data: Buffer;
}): Promise<StoredFile | StoreRefusal> {
  const key = `${ownerId}_${randomUUID()}`;

  const refusal = await reserveUpload({
    id: key,
    ownerId,
    bytes: BigInt(data.length),
  });

  if (refusal) {
    return {
      refused:
        "message" in refusal ? refusal.message : "This file can't be stored.",
    };
  }

  try {
    await storage.upload(key, data);

    const file = await db.$transaction(async (tx) => {
      const created = await tx.file.create({
        data: {
          storageKey: key,
          originalName: name,
          mimeType: mimeType || "application/octet-stream",
          size: BigInt(data.length),
          ownerId,
        },
        select: { id: true, mimeType: true },
      });

      await enqueuePostUploadJobs(tx, {
        id: created.id,
        isEncrypted: false,
        mimeType: created.mimeType,
      });

      await tx.uploadReservation.deleteMany({ where: { id: key } });

      return created;
    });

    return { fileId: file.id };
  } catch (error) {
    // Give the space back and drop any bytes that landed; the row never did.
    await releaseUpload(key).catch(() => {});
    await storage
      .delete(key)
      .catch((cause) =>
        log.warn("ingest.cleanup_failed", { key, error: cause }),
      );
    throw error;
  }
}
