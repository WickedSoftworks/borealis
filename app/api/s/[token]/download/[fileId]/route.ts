import { db } from "@/lib/db";
import { serveFile } from "@/lib/download";
import { parseRange, rangeLength } from "@/lib/range";
import { hit, RULES, tooManyRequests } from "@/lib/rate-limit";
import { rateLimitAddress } from "@/lib/request";
import {
  reconcileShareCapacity,
  reserveShareCapacity,
} from "@/lib/shares/capacity";
import { shareIncludesFile } from "@/lib/shares/contents";
import {
  guardRefusal,
  guardShareRequest,
  publiclyServable,
} from "@/lib/shares/request";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; fileId: string }> },
) {
  const { token, fileId } = await params;

  // Requests, not bytes: a media player seeking through a video issues dozens
  // of small range requests, so the ceiling is generous. What it stops is one
  // client opening hundreds of parallel streams against the box.
  const limit = await hit(
    `download:${rateLimitAddress(req)}`,
    RULES.shareDownloadPerAddress,
  );

  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const share = await db.share.findUnique({ where: { token } });

  if (!share || share.type !== "SEND") {
    return new Response("Not found", { status: 404 });
  }

  // The file must actually belong to this share — otherwise any share token
  // becomes a key to every file on the instance. Resolved through
  // lib/shares/contents.ts so that a file reached via a shared FOLDER is
  // admitted, a file in a trashed folder is not, and this gate can never
  // disagree with what the share page showed.
  const file = await shareIncludesFile(share, fileId);

  if (!file || !publiclyServable(file)) {
    return new Response("Not found", { status: 404 });
  }

  // Resolved before the guard so the egress pre-check is told what this
  // request will actually cost. A recipient seeking the last megabyte of a
  // file should not be turned away because the whole file would not fit under
  // what is left of the cap.
  const rangeHeader = req.headers.get("range");
  const verdict = parseRange(rangeHeader, Number(file.size));
  const projected = BigInt(rangeLength(verdict, Number(file.size)));
  const countDownload = verdict.kind === "full";

  const { verdict: guarded, address: ipAddress } = await guardShareRequest(
    req,
    share,
    {
      intent: "download",
      bytes: projected,
    },
  );

  if (!guarded.ok) return guardRefusal(guarded);
  if (verdict.kind === "unsatisfiable") {
    return serveFile({ file, rangeHeader });
  }

  const transferId = await reserveShareCapacity(
    share,
    projected,
    countDownload,
  );
  if (!transferId) {
    const current = await db.share.findUnique({ where: { id: share.id } });
    const retry = await guardShareRequest(req, current, {
      intent: "download",
      bytes: projected,
    });
    return retry.verdict.ok
      ? new Response("Share capacity changed. Retry the request.", {
          status: 429,
        })
      : guardRefusal(retry.verdict);
  }

  // Read off the request now: the accounting runs after the response has been
  // handed over, and reaching back into `req` from there is not safe.
  const userAgent = req.headers.get("user-agent");

  const response = await serveFile({
    file,
    rangeHeader,
    // Runs once the body has terminated, so it never delays the response and
    // so the numbers describe bytes that really left the box.
    onFinish: async ({ bytesServed, wasFull: servedWhole }) => {
      await reconcileShareCapacity(transferId, bytesServed);
      await db.shareAccess.create({
        data: {
          shareId: share.id,
          fileId: file.id,
          action: "DOWNLOAD",
          ipAddress,
          userAgent,
          bytesServed,
        },
      });

      // One notification per download, not one per range request.
      if (share.notifyOnDownload && servedWhole) {
        await db.job.create({
          data: {
            type: "NOTIFY_DOWNLOAD",
            payload: JSON.stringify({
              shareId: share.id,
              fileId: file.id,
              ipAddress,
              at: new Date().toISOString(),
            }),
          },
        });
      }
    },
  });
  if (response.status >= 400) {
    await reconcileShareCapacity(transferId, 0n, countDownload);
  }
  return response;
}
