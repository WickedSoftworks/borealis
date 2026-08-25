import { randomUUID } from "node:crypto";
import { FileStore } from "@tus/file-store";
import { S3Store } from "@tus/s3-store";
import { type DataStore, Server } from "@tus/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { enqueuePostUploadJobs } from "@/lib/uploads";

export const TUS_PATH = "/api/upload";

/**
 * tus keys are what the StorageProvider addresses. They must stay a SINGLE
 * path segment: tus derives the upload id from the URL relative to `path`, so
 * a `/` inside the id produces a two-segment URL its router won't match (the
 * bytes land on disk but every subsequent PATCH/HEAD 404s). Hence `_` rather
 * than `/` between owner and uuid.
 */
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

/** Metadata values arrive base64-encoded per the tus spec; @tus/server decodes them. */
function metaString(
  metadata: Record<string, string | null> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

let server: Server | undefined;

export function getTusServer(): Server {
  if (server) return server;

  server = new Server({
    path: TUS_PATH,
    datastore: createStore(),
    // Next serves this behind its own router; relative Location headers keep
    // the URL correct regardless of how the app is reverse-proxied.
    relativeLocation: true,
    respectForwardedHeaders: true,

    async namingFunction() {
      // The owner is re-resolved here rather than trusted from metadata.
      const session = await getSession();

      if (!session?.user) {
        throw { status_code: 401, body: "Unauthorized" };
      }

      return `${session.user.id}_${randomUUID()}`;
    },

    // Every tus verb passes through here, so this is the single auth gate.
    async onIncomingRequest(_req) {
      const session = await getSession();

      if (!session?.user) {
        throw { status_code: 401, body: "Unauthorized" };
      }
    },

    async onUploadFinish(_req, upload) {
      const session = await getSession();

      if (!session?.user) {
        throw { status_code: 401, body: "Unauthorized" };
      }

      const isEncrypted = metaString(upload.metadata, "encrypted") === "true";

      // One transaction so the row and the work queued against it commit
      // together — the worker cannot pick up a job whose file does not exist.
      const file = await db.$transaction(async (tx) => {
        const created = await tx.file.create({
          data: {
            storageKey: upload.id,
            originalName: metaString(upload.metadata, "filename") ?? "untitled",
            mimeType:
              metaString(upload.metadata, "filetype") ??
              "application/octet-stream",
            size: BigInt(upload.size ?? upload.offset),
            ownerId: session.user.id,
            folderId: metaString(upload.metadata, "folderId") ?? null,
            isEncrypted,
            encryptionMeta:
              metaString(upload.metadata, "encryptionMeta") ?? null,
          },
          select: { id: true },
        });

        await enqueuePostUploadJobs(tx, { id: created.id, isEncrypted });

        return created;
      });

      // Exposed as a header too — tus clients surface response headers more
      // readily than the completion body.
      return {
        headers: { "X-File-Id": file.id },
        body: JSON.stringify({ fileId: file.id }),
      };
    },
  });

  return server;
}
