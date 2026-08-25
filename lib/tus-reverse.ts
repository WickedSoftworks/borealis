import { randomUUID } from "node:crypto";
import { FileStore } from "@tus/file-store";
import { S3Store } from "@tus/s3-store";
import { type DataStore, Server } from "@tus/server";
import { db } from "@/lib/db";
import { isExpired } from "@/lib/shares/expiry";
import { enqueuePostUploadJobs } from "@/lib/uploads";

export const REVERSE_TUS_PATH = "/api/reverse-upload";

function createStore(): DataStore {
  if (process.env.STORAGE_DRIVER === "s3") {
    const bucket = process.env.S3_BUCKET;

    if (!bucket) {
      throw new Error('STORAGE_DRIVER is "s3" but S3_BUCKET is not set.');
    }

    return new S3Store({
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

  return new FileStore({ directory: process.env.STORAGE_PATH ?? "./uploads" });
}

function metaString(
  metadata: Record<string, string | null> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The share this upload claims to belong to, if it may still accept files. */
async function openReverseShare(token: string | undefined) {
  if (!token) return null;

  const share = await db.share.findUnique({
    where: { token },
    include: { _count: { select: { items: true } } },
  });

  if (!share || share.type !== "REVERSE") return null;
  if (share.revokedAt || isExpired(share.expiresAt)) return null;
  if (
    share.maxUploadFiles !== null &&
    share._count.items >= share.maxUploadFiles
  ) {
    return null;
  }

  return share;
}

let server: Server | undefined;

/**
 * Anonymous uploads into a reverse share.
 *
 * Deliberately a second tus mount rather than a branch inside the authenticated
 * one: that endpoint's rule stays "a session is required, always", and nothing
 * here can weaken it. The share token is the only credential, so every limit on
 * it is checked before a single byte is accepted.
 */
export function getReverseTusServer(): Server {
  if (server) return server;

  server = new Server({
    path: REVERSE_TUS_PATH,
    datastore: createStore(),
    relativeLocation: true,
    respectForwardedHeaders: true,

    async onUploadCreate(_req, upload) {
      const share = await openReverseShare(
        metaString(upload.metadata, "token"),
      );

      if (!share) {
        throw {
          status_code: 403,
          body: "This upload link is not accepting files.",
        };
      }

      const size = upload.size ?? 0;

      if (
        share.maxUploadBytes !== null &&
        BigInt(size) > share.maxUploadBytes
      ) {
        throw {
          status_code: 413,
          body: `That file is larger than this link accepts (${share.maxUploadBytes} bytes).`,
        };
      }

      return {};
    },

    namingFunction() {
      // Owner is resolved from the share at finish; the key stays a single
      // path segment because tus derives the upload id from the URL.
      return `reverse_${randomUUID()}`;
    },

    async onUploadFinish(req, upload) {
      const share = await openReverseShare(
        metaString(upload.metadata, "token"),
      );

      if (!share) {
        throw { status_code: 403, body: "This upload link is no longer open." };
      }

      const uploader = metaString(upload.metadata, "uploader");

      // One transaction: a half-written reverse upload that is in the share but
      // has no audit row, or vice versa, is worse than one that failed outright.
      const file = await db.$transaction(async (tx) => {
        const created = await tx.file.create({
          data: {
            storageKey: upload.id,
            originalName: metaString(upload.metadata, "filename") ?? "untitled",
            mimeType:
              metaString(upload.metadata, "filetype") ??
              "application/octet-stream",
            size: BigInt(upload.size ?? upload.offset),
            // The files belong to whoever opened the link, not to the sender.
            ownerId: share.ownerId,
          },
          select: { id: true },
        });

        await tx.shareItem.create({
          data: { shareId: share.id, fileId: created.id },
        });

        await tx.shareAccess.create({
          data: {
            shareId: share.id,
            fileId: created.id,
            action: "UPLOAD",
            ipAddress: req.headers.get("x-real-ip"),
            userAgent: req.headers.get("user-agent"),
            bytesServed: BigInt(upload.size ?? 0),
          },
        });

        // Nothing on this path is ever client-side encrypted — a stranger with
        // an upload link has no key to encrypt with — so it is stated outright
        // rather than left to the column default.
        await enqueuePostUploadJobs(
          tx,
          { id: created.id, isEncrypted: false },
          { uploader: uploader ?? null },
        );

        return created;
      });

      return { headers: { "X-File-Id": file.id } };
    },
  });

  return server;
}
