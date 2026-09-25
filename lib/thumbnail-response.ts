import { Readable } from "node:stream";
import { after } from "next/server";
import { log } from "@/lib/log";
import { meterStream } from "@/lib/metering";
import { storage } from "@/lib/storage";

export const MAX_SHARED_THUMBNAIL_BYTES = 2 * 1024 * 1024;

/** Bound legacy thumbnail objects before holding one in memory for admission. */
export async function readSharedThumbnail(key: string): Promise<Buffer | null> {
  let source: Readable;
  try {
    source = await storage.stream(key);
  } catch {
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.length;
    if (size > MAX_SHARED_THUMBNAIL_BYTES) {
      source.destroy();
      return null;
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

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
  {
    shared,
    prepared,
    onFinish,
  }: {
    shared: boolean;
    prepared?: Buffer;
    onFinish?: (bytesServed: bigint) => Promise<void>;
  },
): Promise<Response> {
  if (!key) return new Response("Not found", { status: 404 });

  let source: Readable;

  try {
    source = prepared ? Readable.from([prepared]) : await storage.stream(key);
  } catch (error) {
    log.warn("thumbnail.open_failed", { key, error });
    return new Response("Not found", { status: 404 });
  }

  const { metered, served } = onFinish
    ? meterStream(source, BigInt(prepared?.length ?? 0))
    : { metered: source, served: () => 0n };
  if (onFinish) {
    const finished = new Promise<void>((resolve) =>
      metered.once("close", resolve),
    );
    after(async () => {
      await finished;
      await onFinish(served());
    });
  }

  return new Response(Readable.toWeb(metered) as unknown as ReadableStream, {
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
