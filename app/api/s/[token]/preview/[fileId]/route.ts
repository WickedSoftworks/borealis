import { db } from "@/lib/db";
import { serveFile } from "@/lib/download";
import {
  MAX_PREVIEW_BYTES,
  previewable,
  TEXT_PREVIEW_BYTES,
} from "@/lib/preview";
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

/** One VIEW row per file per address per this long, so page loads do not bury downloads. */
const VIEW_LOG_THROTTLE_MS = 10 * 60 * 1000;

/**
 * Inline preview for a recipient: images, PDFs, and the start of text files.
 *
 * Preview bytes consume the same egress budget as downloads. The download
 * count and view-only setting remain independent of that byte budget.
 *
 * Preview is also bounded by allowlisted types
 * (lib/preview.ts), images and PDFs up to MAX_PREVIEW_BYTES, and text only
 * ever as its first TEXT_PREVIEW_BYTES.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; fileId: string }> },
) {
  const { token, fileId } = await params;

  const limit = await hit(
    `download:${rateLimitAddress(req)}`,
    RULES.shareDownloadPerAddress,
  );

  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const share = await db.share.findUnique({ where: { token } });

  if (!share || share.type !== "SEND") {
    return new Response("Not found", { status: 404 });
  }

  const { verdict, address } = await guardShareRequest(req, share, {
    intent: "preview",
  });

  if (!verdict.ok) return guardRefusal(verdict);

  const file = await shareIncludesFile(share, fileId);

  if (!file || !publiclyServable(file)) {
    return new Response("Not found", { status: 404 });
  }

  const preview = previewable(file);

  if (!preview) {
    // The page never offers a View control for these; this answers a direct
    // request with the reason rather than a bare status.
    if (file.isEncrypted) {
      return new Response(
        "Encrypted files are unlocked in your browser; the server cannot preview them.",
        { status: 415 },
      );
    }

    return Number(file.size) > MAX_PREVIEW_BYTES
      ? new Response("Too large to preview. Download it instead.", {
          status: 413,
        })
      : new Response("This kind of file cannot be previewed.", {
          status: 415,
        });
  }

  // Text is only ever its opening slice, whatever the client asked for.
  const truncated =
    preview.kind === "text" && file.size > BigInt(TEXT_PREVIEW_BYTES);
  const rangeHeader = truncated
    ? `bytes=0-${TEXT_PREVIEW_BYTES - 1}`
    : req.headers.get("range");
  const range = parseRange(rangeHeader, Number(file.size));
  const projected = BigInt(rangeLength(range, Number(file.size)));
  const checked = await guardShareRequest(req, share, {
    intent: "preview",
    bytes: projected,
  });
  if (!checked.verdict.ok) return guardRefusal(checked.verdict);
  if (range.kind === "unsatisfiable") {
    return serveFile({
      file,
      rangeHeader,
      inline: { contentType: preview.contentType },
    });
  }
  const transferId = await reserveShareCapacity(share, projected, false);
  if (!transferId) {
    const current = await db.share.findUnique({ where: { id: share.id } });
    const retry = await guardShareRequest(req, current, {
      intent: "preview",
      bytes: projected,
    });
    return retry.verdict.ok
      ? new Response("Share capacity changed. Retry the request.", {
          status: 429,
        })
      : guardRefusal(retry.verdict);
  }

  const userAgent = req.headers.get("user-agent");

  const response = await serveFile({
    file,
    rangeHeader,
    inline: { contentType: preview.contentType },
    onFinish: async ({ bytesServed }) => {
      await reconcileShareCapacity(transferId, bytesServed);
      const recent = await db.shareAccess.findFirst({
        where: {
          shareId: share.id,
          fileId: file.id,
          action: "VIEW",
          ipAddress: address,
          createdAt: { gt: new Date(Date.now() - VIEW_LOG_THROTTLE_MS) },
        },
        select: { id: true },
      });
      if (recent) {
        await db.shareAccess.update({
          where: { id: recent.id },
          data: { bytesServed: { increment: bytesServed } },
        });
      } else {
        await db.shareAccess.create({
          data: {
            shareId: share.id,
            fileId: file.id,
            action: "VIEW",
            ipAddress: address,
            userAgent,
            bytesServed,
          },
        });
      }
    },
  });
  if (response.status >= 400) {
    await reconcileShareCapacity(transferId, 0n);
  }

  // Share bytes must not outlive the link in any cache, the browser's included.
  response.headers.set("Cache-Control", "private, no-store, no-transform");
  if (truncated) response.headers.set("X-Borealis-Truncated", "true");

  return response;
}
