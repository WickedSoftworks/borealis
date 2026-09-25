import { randomUUID } from "node:crypto";
import { Server } from "@tus/server";
import { db } from "@/lib/db";
import { reserveUpload } from "@/lib/quota";
import { hit, RULES } from "@/lib/rate-limit";
import { clientIp, parseCidrList, rateLimitAddress } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { isExpired } from "@/lib/shares/expiry";
import { addressAllowed } from "@/lib/shares/guard";
import { createTusStore, metaString } from "@/lib/tus-store";
import { enqueuePostUploadJobs } from "@/lib/uploads";

export const REVERSE_TUS_PATH = "/api/reverse-upload";

/** The share this upload claims to belong to, if it may still accept files. */
async function openReverseShare(token: string | undefined, req: Request) {
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

  const { deniedIps } = await getSettings();

  if (
    !addressAllowed(
      share.allowedIps,
      clientIp(req),
      parseCidrList(deniedIps).ranges,
    )
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

  const store = createTusStore();
  server = new Server({
    path: REVERSE_TUS_PATH,
    datastore: store,
    relativeLocation: true,
    respectForwardedHeaders: true,
    disableTerminationForFinishedUploads: true,

    async onIncomingRequest(req, uploadId) {
      if (req.method === "GET") {
        throw { status_code: 405, body: "Use the share download endpoint." };
      }
      if (req.method === "POST") return;
      if (!uploadId.startsWith("reverse_")) {
        throw { status_code: 403, body: "Forbidden" };
      }
      if (await db.file.count({ where: { storageKey: uploadId } })) {
        throw {
          status_code: 403,
          body: "Completed files cannot be changed here.",
        };
      }

      // A tus URL identifies an upload; it is not the share credential.
      // Match the supplied credential to the one stored at creation.
      const token = req.headers.get("x-reverse-share-token");
      if (!token || !(await openReverseShare(token, req))) {
        throw {
          status_code: 403,
          body: "This upload link is not accepting files.",
        };
      }
      const upload = await store.getUpload(uploadId).catch(() => null);
      if (!upload || metaString(upload.metadata, "token") !== token) {
        throw { status_code: 403, body: "Forbidden" };
      }
    },

    async onUploadCreate(req, upload) {
      const limit = await hit(
        `reverse-upload:${rateLimitAddress(req)}`,
        RULES.reverseUploadPerAddress,
      );

      if (!limit.allowed) {
        throw {
          status_code: 429,
          body: "Too many uploads from here. Wait a while and try again.",
        };
      }

      const share = await openReverseShare(
        metaString(upload.metadata, "token"),
        req,
      );

      if (!share) {
        throw {
          status_code: 403,
          body: "This upload link is not accepting files.",
        };
      }

      if (upload.size === undefined) {
        throw { status_code: 411, body: "Uploads must declare their size." };
      }

      const size = BigInt(upload.size);

      if (share.maxUploadBytes !== null && size > share.maxUploadBytes) {
        throw {
          status_code: 413,
          body: `That file is larger than this link accepts (${share.maxUploadBytes} bytes).`,
        };
      }

      // Counted against the owner, whose disk it is. The stranger is told
      // only that the link cannot take the file — the owner's quota and usage
      // are not theirs to learn.
      if (await reserveUpload(upload.id, share.ownerId, size, share.id)) {
        throw {
          status_code: 413,
          body: "This link can't accept a file that size right now. Let the person who sent it know.",
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
        req,
      );

      if (!share) {
        throw { status_code: 403, body: "This upload link is no longer open." };
      }

      const uploader = metaString(upload.metadata, "uploader");

      // One transaction: a half-written reverse upload that is in the share but
      // has no audit row, or vice versa, is worse than one that failed outright.
      const file = await db.$transaction(async (tx) => {
        const reservation = await tx.uploadReservation.deleteMany({
          where: { id: upload.id, ownerId: share.ownerId, shareId: share.id },
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
            // The files belong to whoever opened the link, not to the sender.
            ownerId: share.ownerId,
          },
          select: { id: true, mimeType: true },
        });

        await tx.shareItem.create({
          data: { shareId: share.id, fileId: created.id },
        });

        await tx.shareAccess.create({
          data: {
            shareId: share.id,
            fileId: created.id,
            action: "UPLOAD",
            ipAddress: clientIp(req),
            userAgent: req.headers.get("user-agent"),
            bytesServed: BigInt(upload.size ?? 0),
          },
        });

        // Nothing on this path is ever client-side encrypted — a stranger with
        // an upload link has no key to encrypt with — so it is stated outright
        // rather than left to the column default.
        await enqueuePostUploadJobs(
          tx,
          { id: created.id, isEncrypted: false, mimeType: created.mimeType },
          { uploader: uploader ?? null },
        );

        return created;
      });

      return { headers: { "X-File-Id": file.id } };
    },
  });

  return server;
}
