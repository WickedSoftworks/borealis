import { after } from "next/server";
import { db } from "@/lib/db";
import { contentDisposition } from "@/lib/http";
import { clientIp } from "@/lib/request";
import { shareIncludesFile } from "@/lib/shares/contents";
import { GUARD_STATUS, guardShare, unlockCookieName } from "@/lib/shares/guard";
import { storage } from "@/lib/storage";

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

  const verdict = guardShare(share, {
    isDownload: true,
    bytes: file.size,
    unlockToken: cookie ? decodeURIComponent(cookie) : undefined,
  });

  if (!verdict.ok) {
    return new Response(verdict.reason, {
      status: GUARD_STATUS[verdict.reason],
      headers: { "X-Borealis-Reason": verdict.reason },
    });
  }

  const buffer = await storage.download(file.storageKey);

  // Account for the bytes and log the access without delaying the response.
  after(async () => {
    await db.$transaction([
      db.share.update({
        where: { id: share.id },
        data: {
          downloadCount: { increment: 1 },
          egressUsedBytes: { increment: BigInt(buffer.byteLength) },
        },
      }),
      db.shareAccess.create({
        data: {
          shareId: share.id,
          fileId: file.id,
          action: "DOWNLOAD",
          ipAddress: clientIp(req),
          userAgent: req.headers.get("user-agent"),
          bytesServed: BigInt(buffer.byteLength),
        },
      }),
    ]);

    if (share.notifyOnDownload) {
      await db.job.create({
        data: {
          type: "NOTIFY_DOWNLOAD",
          payload: JSON.stringify({ shareId: share.id, fileId: file.id }),
        },
      });
    }
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(buffer.byteLength),
      "Content-Disposition": contentDisposition(file.originalName),
    },
  });
}
