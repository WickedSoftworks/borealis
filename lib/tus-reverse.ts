import { randomUUID } from "node:crypto";
import { Server } from "@tus/server";
import { db } from "@/lib/db";
import { checkQuota } from "@/lib/quota";
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

/** Every upload this mount names starts with this; nothing else is its to touch. */
const REVERSE_KEY_PREFIX = "reverse_";

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

  const datastore = createTusStore();

  server = new Server({
    path: REVERSE_TUS_PATH,
    datastore,
    relativeLocation: true,
    respectForwardedHeaders: true,

    // A finished upload is the link owner's file now. The stranger who sent
    // it may not take it back out of their vault.
    disableTerminationForFinishedUploads: true,

    /**
     * Both mounts write to one directory or bucket, so without this an upload
     * URL was a key to more than the upload: GET served any finished file's
     * raw bytes with no share check at all — past revocation, the scan
     * verdict, and the trash — and DELETE removed them from under their row.
     *
     * Now GET is refused outright (the route does not export it either), only
     * ids this mount named are reachable, and resuming re-checks the link the
     * upload was started against, so revoking or expiring it, or an allow
     * list that no longer admits the sender, stops bytes still in flight.
     * Cancelling one's own unfinished upload stays allowed.
     */
    async onIncomingRequest(req, uploadId) {
      if (req.method === "GET") {
        throw { status_code: 405, body: "Method not allowed" };
      }

      if (!uploadId.startsWith(REVERSE_KEY_PREFIX)) {
        throw { status_code: 404, body: "Not found" };
      }

      if (req.method !== "PATCH" && req.method !== "HEAD") return;

      // The token in an upload's metadata was checked when it was created
      // and tus never lets a client change it, so it binds the upload to
      // that one link.
      const upload = await datastore.getUpload(uploadId);

      if (
        !(await openReverseShare(metaString(upload.metadata, "token"), req))
      ) {
        throw { status_code: 403, body: "This upload link is no longer open." };
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
      if (await checkQuota(share.ownerId, size)) {
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
      return `${REVERSE_KEY_PREFIX}${randomUUID()}`;
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
