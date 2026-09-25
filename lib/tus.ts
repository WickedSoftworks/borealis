import { randomUUID } from "node:crypto";
import { Server } from "@tus/server";
import { db } from "@/lib/db";
import { assertOwnedFolder } from "@/lib/folders";
import { reserveUpload } from "@/lib/quota";
import { hit, RULES } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { createTusStore, metaString } from "@/lib/tus-store";
import { enqueuePostUploadJobs } from "@/lib/uploads";

export const TUS_PATH = "/api/upload";

let server: Server | undefined;

/**
 * tus keys are what the StorageProvider addresses. They must stay a SINGLE
 * path segment: tus derives the upload id from the URL relative to `path`, so
 * a `/` inside the id produces a two-segment URL its router won't match (the
 * bytes land on disk but every subsequent PATCH/HEAD 404s). Hence `_` rather
 * than `/` between owner and uuid.
 */
export function getTusServer(): Server {
  if (server) return server;

  server = new Server({
    path: TUS_PATH,
    datastore: createTusStore(),
    // Next serves this behind its own router; relative Location headers keep
    // the URL correct regardless of how the app is reverse-proxied.
    relativeLocation: true,
    respectForwardedHeaders: true,
    disableTerminationForFinishedUploads: true,

    async namingFunction() {
      // The owner is re-resolved here rather than trusted from metadata.
      const session = await getSession();

      if (!session?.user) {
        throw { status_code: 401, body: "Unauthorized" };
      }

      return `${session.user.id}_${randomUUID()}`;
    },

    // Every tus verb passes through here, so this is the single auth gate.
    async onIncomingRequest(req, uploadId) {
      const session = await getSession();

      if (!session?.user) {
        throw { status_code: 401, body: "Unauthorized" };
      }

      if (req.method === "GET") {
        throw { status_code: 405, body: "Use the file download endpoint." };
      }
      if (req.method !== "POST") {
        if (!uploadId.startsWith(`${session.user.id}_`)) {
          throw { status_code: 403, body: "Forbidden" };
        }
        if (await db.file.count({ where: { storageKey: uploadId } })) {
          throw {
            status_code: 403,
            body: "Completed files cannot be changed here.",
          };
        }
      }
    },

    /**
     * The quota gate, before a single byte is accepted.
     *
     * A deferred length (`Upload-Defer-Length`) would let a client start an
     * upload of undeclared size and dodge every ceiling, so it is refused
     * outright; tus-js-client only defers when asked to.
     */
    async onUploadCreate(_req, upload) {
      const session = await getSession();

      if (!session?.user) {
        throw { status_code: 401, body: "Unauthorized" };
      }

      const limit = await hit(`upload:${session.user.id}`, RULES.uploadPerUser);

      if (!limit.allowed) {
        throw {
          status_code: 429,
          body: "Too many uploads started at once. Wait a moment and try again.",
        };
      }

      if (upload.size === undefined) {
        throw {
          status_code: 411,
          body: "Uploads must declare their size.",
        };
      }

      const refusal = await reserveUpload(
        upload.id,
        session.user.id,
        BigInt(upload.size),
      );

      if (refusal) {
        throw { status_code: 413, body: refusal.message };
      }

      return {};
    },

    async onUploadFinish(_req, upload) {
      const session = await getSession();

      if (!session?.user) {
        throw { status_code: 401, body: "Unauthorized" };
      }

      const isEncrypted = metaString(upload.metadata, "encrypted") === "true";

      // tus metadata is client-supplied, so the folder is re-resolved against
      // this account rather than trusted — the same rule namingFunction applies
      // to the owner. An id that is unknown, trashed, or someone else's lands
      // the upload at the root instead of failing it: the bytes are already on
      // disk by now, and refusing here would strand them.
      const folderId = await assertOwnedFolder(
        metaString(upload.metadata, "folderId"),
        session.user.id,
      );

      // One transaction so the row and the work queued against it commit
      // together — the worker cannot pick up a job whose file does not exist.
      const file = await db.$transaction(async (tx) => {
        const reservation = await tx.uploadReservation.deleteMany({
          where: { id: upload.id, ownerId: session.user.id, shareId: null },
        });
        if (reservation.count !== 1) {
          throw { status_code: 410, body: "Upload reservation has expired." };
        }
        const created = await tx.file.create({
          data: {
            storageKey: upload.id,
            originalName: metaString(upload.metadata, "filename") ?? "untitled",
            mimeType:
              metaString(upload.metadata, "filetype") ??
              "application/octet-stream",
            size: BigInt(upload.size ?? upload.offset),
            ownerId: session.user.id,
            folderId,
            isEncrypted,
            encryptionMeta:
              metaString(upload.metadata, "encryptionMeta") ?? null,
          },
          select: { id: true, mimeType: true },
        });

        await enqueuePostUploadJobs(tx, {
          id: created.id,
          isEncrypted,
          mimeType: created.mimeType,
        });

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
