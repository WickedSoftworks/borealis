import { randomUUID } from "node:crypto";
import { EVENTS, Server } from "@tus/server";
import { db } from "@/lib/db";
import { assertOwnedFolder } from "@/lib/folders";
import { log } from "@/lib/log";
import { releaseUpload, reserveUpload } from "@/lib/quota";
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

    async namingFunction() {
      // The owner is re-resolved here rather than trusted from metadata.
      const session = await getSession();

      if (!session?.user) {
        throw { status_code: 401, body: "Unauthorized" };
      }

      return `${session.user.id}_${randomUUID()}`;
    },

    // A finished upload is a file, and deleting a file goes through the
    // trash and its audit trail — not through tus.
    disableTerminationForFinishedUploads: true,

    /**
     * Every tus verb passes through here, so this is the single auth gate.
     *
     * A session alone is not enough: an upload belongs to the account whose
     * id namingFunction put in front of it, and nobody else may append to it,
     * read its metadata, or cancel it. Without this, anyone signed in who
     * had another account's upload URL could finish that upload as
     * themselves — onUploadFinish takes the owner from the session.
     *
     * GET is refused outright. tus serves a finished upload's raw bytes on
     * it, which would skip the trash, the scan verdict, and every rule
     * /api/file applies; the route does not export GET either.
     */
    async onIncomingRequest(req, uploadId) {
      const session = await getSession();

      if (!session?.user) {
        throw { status_code: 401, body: "Unauthorized" };
      }

      if (req.method === "GET") {
        throw { status_code: 405, body: "Method not allowed" };
      }

      if (!uploadId.startsWith(`${session.user.id}_`)) {
        // The same answer as an id that does not exist.
        throw { status_code: 404, body: "Not found" };
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

      // Held from now until it lands, so uploads in flight count against the
      // quota too — not only the ones that have already finished.
      const refusal = await reserveUpload({
        id: upload.id,
        ownerId: session.user.id,
        bytes: BigInt(upload.size),
      });

      if (refusal) {
        throw {
          status_code: 413,
          body:
            "message" in refusal
              ? refusal.message
              : "This upload can't be accepted.",
        };
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

        // The file row counts against the quota from here; the promise of
        // it no longer needs to.
        await tx.uploadReservation.deleteMany({ where: { id: upload.id } });

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

  // A cancelled upload gives its space back at once rather than at expiry.
  server.on(EVENTS.POST_TERMINATE, (_req, _res, id: string) => {
    releaseUpload(id).catch((error) =>
      log.warn("uploads.release_failed", { id, error }),
    );
  });

  return server;
}
