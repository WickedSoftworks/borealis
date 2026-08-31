import { db } from "@/lib/db";
import { serveFile } from "@/lib/download";
import { parseRange, rangeLength } from "@/lib/range";
import { clientIp } from "@/lib/request";
import { shareIncludesFile } from "@/lib/shares/contents";
import { GUARD_STATUS, guardShare, unlockCookieName } from "@/lib/shares/guard";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; fileId: string }> },
) {
  const { token, fileId } = await params;

  const share = await db.share.findUnique({ where: { token } });

  if (!share) {
    return new Response("Not found", { status: 404 });
  }

  // The file must actually belong to this share — otherwise any share token
  // becomes a key to every file on the instance. Resolved through
  // lib/shares/contents.ts so that a file reached via a shared FOLDER is
  // admitted, a file in a trashed folder is not, and this gate can never
  // disagree with what the share page showed.
  const file = await shareIncludesFile(share, fileId);

  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  const cookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${unlockCookieName(share.id)}=`))
    ?.split("=")
    .slice(1)
    .join("=");

  // Resolved before the guard so the egress pre-check is told what this
  // request will actually cost. A recipient seeking the last megabyte of a
  // file should not be turned away because the whole file would not fit under
  // what is left of the cap.
  const rangeHeader = req.headers.get("range");
  const verdict = parseRange(rangeHeader, Number(file.size));

  const guarded = guardShare(share, {
    isDownload: true,
    bytes: BigInt(rangeLength(verdict, Number(file.size))),
    unlockToken: cookie ? decodeURIComponent(cookie) : undefined,
  });

  if (!guarded.ok) {
    return new Response(guarded.reason, {
      status: GUARD_STATUS[guarded.reason],
      headers: { "X-Borealis-Reason": guarded.reason },
    });
  }

  // Read off the request now: the accounting runs after the response has been
  // handed over, and reaching back into `req` from there is not safe.
  const ipAddress = clientIp(req);
  const userAgent = req.headers.get("user-agent");

  return serveFile({
    file,
    rangeHeader,
    // Runs once the body has terminated, so it never delays the response and
    // so the numbers describe bytes that really left the box.
    onFinish: async ({ bytesServed, wasFull: servedWhole }) => {
      await db.$transaction([
        db.share.update({
          where: { id: share.id },
          data: {
            // A resume or a media seek costs bandwidth but is not another
            // download; counting one per request would let a single scrub
            // through a video exhaust a three-download cap.
            ...(servedWhole ? { downloadCount: { increment: 1 } } : {}),
            egressUsedBytes: { increment: bytesServed },
          },
        }),
        db.shareAccess.create({
          data: {
            shareId: share.id,
            fileId: file.id,
            action: "DOWNLOAD",
            ipAddress,
            userAgent,
            bytesServed,
          },
        }),
      ]);

      // One notification per download, not one per range request.
      if (share.notifyOnDownload && servedWhole) {
        await db.job.create({
          data: {
            type: "NOTIFY_DOWNLOAD",
            payload: JSON.stringify({ shareId: share.id, fileId: file.id }),
          },
        });
      }
    },
  });
}
