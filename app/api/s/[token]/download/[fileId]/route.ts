import { db } from "@/lib/db";
import { serveFile } from "@/lib/download";
import { parseRange, rangeLength } from "@/lib/range";
import { hit, RULES, tooManyRequests } from "@/lib/rate-limit";
import { rateLimitAddress } from "@/lib/request";
import { release, reserve, settle } from "@/lib/shares/allowance";
import { shareIncludesFile } from "@/lib/shares/contents";
import { downloadEquivalent } from "@/lib/shares/downloads";
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

  if (share?.type !== "SEND") {
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

  const { verdict: guarded, address: ipAddress } = await guardShareRequest(
    req,
    share,
    {
      intent: "download",
      bytes: BigInt(rangeLength(verdict, Number(file.size))),
    },
  );

  if (!guarded.ok) return guardRefusal(guarded);

  // An unsatisfiable range is answered without a byte, and costs nothing.
  if (verdict.kind === "unsatisfiable") return serveFile({ file, rangeHeader });

  // The guard only read the counters; this takes the cost from them before a
  // byte goes, so requests started together cannot all spend one remainder.
  // A range costs its fraction of a download, so a file fetched in pieces is
  // still one download, not a free copy.
  const requested = BigInt(rangeLength(verdict, Number(file.size)));
  const reserved = {
    downloads: downloadEquivalent(requested, file.size),
    bytes: requested,
  };
  const refusal = await reserve(share, reserved);

  if (refusal) return guardRefusal({ ok: false, reason: refusal });

  // Read off the request now: the accounting runs after the response has been
  // handed over, and reaching back into `req` from there is not safe.
  const userAgent = req.headers.get("user-agent");

  const response = await serveFile({
    file,
    rangeHeader,
    // Runs once the body has terminated, so it never delays the response and
    // so the numbers describe bytes that really left the box.
    onFinish: async ({ bytesServed, wasFull: servedWhole }) => {
      await db.$transaction([
        // Whatever the body did not carry goes back: a transfer abandoned at
        // 40% has cost 0.4 of a download, and resuming it costs the rest.
        settle(share.id, reserved, {
          downloads: downloadEquivalent(bytesServed, file.size),
          bytes: bytesServed,
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

  // The object could not be opened, so no body runs and nothing will settle.
  if (response.status !== 200 && response.status !== 206) {
    await release(share.id, reserved);
  }

  return response;
}
