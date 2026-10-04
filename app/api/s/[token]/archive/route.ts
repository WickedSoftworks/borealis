import {
  type ArchiveFile,
  archiveName,
  archiveResponse,
  noteEntry,
  omissionsNote,
  planArchive,
  sharePaths,
} from "@/lib/archive";
import { db } from "@/lib/db";
import { hit, RULES, tooManyRequests } from "@/lib/rate-limit";
import { rateLimitAddress } from "@/lib/request";
import { reserve, settle } from "@/lib/shares/allowance";
import { shareContents } from "@/lib/shares/contents";
import { downloadEquivalent } from "@/lib/shares/downloads";
import {
  guardRefusal,
  guardShareRequest,
  publiclyServable,
} from "@/lib/shares/request";

export const runtime = "nodejs";

/**
 * Everything in a link, as one ZIP.
 *
 * Accounted as ONE download: a recipient taking the whole bundle at once has
 * downloaded the link once, and counting it per file would make "download
 * all" the most expensive way to take what they were given. Egress is the
 * archive's exact size, reserved before the first byte, so the transfer cap
 * holds either way.
 *
 * Encrypted files are left out, because the server has only ciphertext to
 * put in the archive, and a scanner-flagged file is left out because no
 * public route serves one. Both are listed in a note inside the archive, so
 * nothing goes missing silently.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const limit = await hit(
    `download:${rateLimitAddress(req)}`,
    RULES.shareDownloadPerAddress,
  );

  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const share = await db.share.findUnique({ where: { token } });

  if (!share || share.type !== "SEND") {
    return new Response("Not found", { status: 404 });
  }

  // A first pass for everything but the egress projection, so a locked or
  // closed link is refused before its contents are resolved.
  const early = await guardShareRequest(req, share, { intent: "download" });
  if (!early.verdict.ok) return guardRefusal(early.verdict);

  const listed = sharePaths(await shareContents(share));
  const included = listed.filter(
    ({ file }) => !file.isEncrypted && publiclyServable(file),
  );
  const omitted = listed
    .filter((entry) => !included.includes(entry))
    .map(({ file, path }) => ({
      path,
      reason: file.isEncrypted
        ? "encrypted in the sender's browser"
        : "withheld by the malware scanner",
    }));

  if (included.length === 0) {
    return new Response(
      "Nothing in this link can be archived by the server. Download the files one at a time.",
      { status: 409 },
    );
  }

  const keys = new Map(
    (
      await db.file.findMany({
        where: {
          id: { in: included.map(({ file }) => file.id) },
          ownerId: share.ownerId,
        },
        select: { id: true, storageKey: true },
      })
    ).map((row) => [row.id, row.storageKey]),
  );

  const files: ArchiveFile[] = included.flatMap(({ file, path }) => {
    const storageKey = keys.get(file.id);
    return storageKey
      ? [
          {
            id: file.id,
            path,
            storageKey,
            size: file.size,
            createdAt: file.createdAt,
          },
        ]
      : [];
  });

  const plan = planArchive(
    files,
    omitted.length > 0 ? [noteEntry(omissionsNote(omitted))] : [],
  );

  const { verdict, address } = await guardShareRequest(req, share, {
    intent: "download",
    bytes: plan.totalSize,
  });

  if (!verdict.ok) return guardRefusal(verdict);

  // Taken before the first byte, as on the download route, so archives
  // started together cannot all spend one remainder of the caps.
  const reserved = { downloads: 1, bytes: plan.totalSize };
  const refusal = await reserve(share, reserved);

  if (refusal) return guardRefusal({ ok: false, reason: refusal });

  const userAgent = req.headers.get("user-agent");

  return archiveResponse({
    plan,
    filename: archiveName(share.name),
    // Settled the way a file is on the download route: an archive abandoned
    // halfway has cost half a download and the bytes that actually went out.
    onFinish: async (bytesServed) => {
      await db.$transaction([
        settle(share.id, reserved, {
          downloads: downloadEquivalent(bytesServed, plan.totalSize),
          bytes: bytesServed,
        }),
        db.shareAccess.create({
          data: {
            shareId: share.id,
            // No single file: the log reads "every file, as a ZIP".
            fileId: null,
            action: "DOWNLOAD",
            ipAddress: address,
            userAgent,
            bytesServed,
          },
        }),
      ]);

      if (share.notifyOnDownload) {
        await db.job.create({
          data: {
            type: "NOTIFY_DOWNLOAD",
            payload: JSON.stringify({
              shareId: share.id,
              fileId: null,
              archive: files.length,
              ipAddress: address,
              at: new Date().toISOString(),
            }),
          },
        });
      }
    },
  });
}
