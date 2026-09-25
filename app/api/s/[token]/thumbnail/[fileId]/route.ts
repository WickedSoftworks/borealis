import { db } from "@/lib/db";
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
import { readSharedThumbnail, serveThumbnail } from "@/lib/thumbnail-response";

export const runtime = "nodejs";

/**
 * A file's thumbnail, for the recipient's file list.
 *
 * Guarded exactly like a preview — the same lifecycle, address, and password
 * gates — because a thumbnail of a photo is a smaller copy of that photo, not
 * metadata about it. Not logged: the page requests one per image on every
 * load, and the preview route already records when a file is actually opened.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; fileId: string }> },
) {
  const { token, fileId } = await params;

  const share = await db.share.findUnique({ where: { token } });

  if (!share || share.type !== "SEND") {
    return new Response("Not found", { status: 404 });
  }

  const { verdict } = await guardShareRequest(req, share, {
    intent: "preview",
  });

  if (!verdict.ok) return guardRefusal(verdict);

  const file = await shareIncludesFile(share, fileId);

  if (!file || !publiclyServable(file)) {
    return new Response("Not found", { status: 404 });
  }

  if (!file.thumbnailKey) return new Response("Not found", { status: 404 });
  const bytes = await readSharedThumbnail(file.thumbnailKey);
  if (!bytes) return new Response("Not found", { status: 404 });
  const projected = BigInt(bytes.length);
  const checked = await guardShareRequest(req, share, {
    intent: "preview",
    bytes: projected,
  });
  if (!checked.verdict.ok) return guardRefusal(checked.verdict);
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
  return serveThumbnail(file.thumbnailKey, {
    shared: true,
    prepared: bytes,
    onFinish: (served) => reconcileShareCapacity(transferId, served),
  });
}
