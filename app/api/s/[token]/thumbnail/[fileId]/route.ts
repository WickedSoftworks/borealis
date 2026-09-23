import { db } from "@/lib/db";
import { shareIncludesFile } from "@/lib/shares/contents";
import {
  guardRefusal,
  guardShareRequest,
  publiclyServable,
} from "@/lib/shares/request";
import { serveThumbnail } from "@/lib/thumbnail-response";

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

  return serveThumbnail(file.thumbnailKey, { shared: true });
}
