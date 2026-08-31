import { Readable } from "node:stream";
import { after } from "next/server";

import { contentDisposition } from "@/lib/http";
import { meterStream } from "@/lib/metering";
import { contentRange, parseRange, rangeLength } from "@/lib/range";
import { storage } from "@/lib/storage";

/**
 * Serving stored bytes over HTTP.
 *
 * Both download routes — the owner's and the share guard's — end here, so the
 * headers, the range negotiation, and the byte counting cannot drift apart
 * between a path that requires a session and a path that serves strangers.
 *
 * Nothing in this file decides *whether* to serve. Authorisation is the
 * caller's job and happens before `serveFile` is reached; by the time we are
 * here the only remaining questions are which bytes and how they are framed.
 */

/** The parts of a `File` row this needs. */
export type ServableFile = {
  storageKey: string;
  mimeType: string;
  originalName: string;
  size: bigint;
};

export type DownloadOutcome = {
  /** Bytes that actually went out, not bytes that were asked for. */
  bytesServed: bigint;
  /** Whether this request was for the whole object. */
  wasFull: boolean;
};

export type ServeFileOptions = {
  file: ServableFile;
  /** The request's raw `Range` header, if any. */
  rangeHeader: string | null;
  /**
   * Called once the body has terminated — cleanly, cancelled, or errored —
   * with what was really served. Registered through `after()`, so it never
   * delays the response, and never runs at all for a request that was refused
   * before any bytes were read.
   */
  onFinish?: (outcome: DownloadOutcome) => void | Promise<void>;
};

/**
 * Build the response for a file download, streaming and range-aware.
 *
 * The object is never buffered: a 4 GB download costs one chunk of heap rather
 * than 4 GB, which is the whole point — two concurrent recipients used to be
 * enough to take the container out.
 */
export async function serveFile({
  file,
  rangeHeader,
  onFinish,
}: ServeFileOptions): Promise<Response> {
  const size = Number(file.size);
  const verdict = parseRange(rangeHeader, size);

  if (verdict.kind === "unsatisfiable") {
    return new Response("Range not satisfiable", {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": contentRange(null, size),
      },
    });
  }

  const range = verdict.kind === "partial" ? verdict.range : undefined;

  let source: Readable;

  try {
    source = await storage.stream(file.storageKey, range);
  } catch (error) {
    // The last moment a missing object can still be an honest 404. Once the
    // first byte is out, the status is spent and a failure can only truncate.
    console.warn(
      `borealis: could not open ${file.storageKey} for download:`,
      error,
    );

    return new Response("Not found", { status: 404 });
  }

  const { metered, served } = meterStream(source);

  if (onFinish) {
    const wasFull = verdict.kind === "full";

    // Subscribed HERE, while the stream is still live, and deliberately not
    // inside the `after` callback: that callback runs once the response is
    // done, by which point `close` has already fired and a listener attached
    // then would wait forever. A missed accounting write is a free download.
    const finished = new Promise<void>((resolve) => {
      metered.once("close", resolve);
    });

    after(async () => {
      await finished;
      await onFinish({ bytesServed: served(), wasFull });
    });
  }

  // `Readable.toWeb` is typed against Node's own stream declarations, which
  // are structurally the DOM's but not nominally, so the hop through unknown
  // is a types formality rather than a claim about the value.
  const body = Readable.toWeb(metered) as unknown as ReadableStream<Uint8Array>;

  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(rangeLength(verdict, size)),
      "Content-Disposition": contentDisposition(file.originalName),

      // What makes a dropped download resumable and media seekable.
      "Accept-Ranges": "bytes",

      ...(range ? { "Content-Range": contentRange(range, size) } : {}),

      // `no-transform` is load-bearing, not hygiene: Next compresses route
      // handler responses by default, and a gzipped body loses its
      // Content-Length and stops agreeing with the byte offsets in
      // Content-Range. `private` is right on its own merits — these bytes sit
      // behind a session or a share guard and must never reach a shared cache.
      "Cache-Control": "private, no-transform",

      // This route serves whatever an uploader gave it. Never let a browser
      // decide the type is something more interesting than we said.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
