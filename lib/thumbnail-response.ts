import { Readable } from "node:stream";
import { log } from "@/lib/log";
import { storage } from "@/lib/storage";

/**
 * The response for a stored thumbnail. Always `image/webp` — the THUMBNAIL job
 * only ever writes WebP — so nothing about the original file's claimed type
 * reaches this header.
 *
 * `shared` responses are not cached at all, so a thumbnail stops loading the
 * moment its link is revoked. The owner's own may be cached privately for a
 * while, since the vault redraws them constantly.
 */
export async function serveThumbnail(
  key: string | null,
  { shared }: { shared: boolean },
): Promise<Response> {
  if (!key) return new Response("Not found", { status: 404 });

  let source: Readable;

  try {
    source = await storage.stream(key);
  } catch (error) {
    log.warn("thumbnail.open_failed", { key, error });
    return new Response("Not found", { status: 404 });
  }

  return new Response(Readable.toWeb(source) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": shared
        ? "private, no-store"
        : "private, max-age=3600, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
