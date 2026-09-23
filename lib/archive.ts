import { Readable } from "node:stream";
import { after } from "next/server";
import { contentDisposition } from "@/lib/http";
import { meterStream } from "@/lib/metering";
import type {
  ShareContents,
  ShareFile,
  ShareFolder,
} from "@/lib/shares/contents";
import { storage } from "@/lib/storage";
import {
  planZip,
  type ZipEntryInput,
  type ZipPlan,
  zipStream,
} from "@/lib/zip/write";

/**
 * Many files as one download.
 *
 * Built on lib/zip/write.ts: stored entries, so the archive's length is known
 * before it is sent and goes out as a real Content-Length. That same number is
 * what a share's egress pre-check is given, so a link with 2 GB of cap left
 * refuses a 3 GB archive up front instead of cutting it off two-thirds of the
 * way through.
 *
 * Not resumable. A byte range in the middle of an archive would need the CRCs
 * of every entry before it, which exist only once those entries have streamed;
 * the response says `Accept-Ranges: none` so a download manager does not try.
 */

export type ArchiveFile = {
  id: string;
  /** Path inside the archive, folders included. */
  path: string;
  storageKey: string;
  size: bigint;
  createdAt: Date;
};

/** A share's tree as archive paths, folders preserved. */
export function sharePaths(contents: ShareContents): Array<{
  file: ShareFile;
  path: string;
}> {
  const out: Array<{ file: ShareFile; path: string }> = [];

  const walk = (folder: ShareFolder, prefix: string) => {
    const here = `${prefix}${folder.name}/`;
    for (const file of folder.files)
      out.push({ file, path: `${here}${file.originalName}` });
    for (const child of folder.folders) walk(child, here);
  };

  for (const folder of contents.folders) walk(folder, "");
  for (const file of contents.files)
    out.push({ file, path: file.originalName });

  return out;
}

export function planArchive(
  files: ArchiveFile[],
  extra: ZipEntryInput[] = [],
): ZipPlan {
  const entries: ZipEntryInput[] = files.map((file) => ({
    name: file.path,
    size: file.size,
    modifiedAt: file.createdAt,
    open: () => storage.stream(file.storageKey),
  }));

  return planZip([...entries, ...extra]);
}

/** A note placed in the archive when some files could not be included. */
export function omissionsNote(
  omitted: Array<{ path: string; reason: string }>,
): string {
  return [
    "Some files in this link were left out of the archive:",
    "",
    ...omitted.map((entry) => `  ${entry.path} — ${entry.reason}`),
    "",
    "Encrypted files are unlocked in the browser, so the server cannot put",
    "readable copies into an archive. Download them one at a time from the page.",
    "",
  ].join("\n");
}

export function noteEntry(text: string): ZipEntryInput {
  const bytes = Buffer.from(text, "utf8");

  return {
    name: "NOT INCLUDED.txt",
    size: BigInt(bytes.length),
    modifiedAt: new Date(),
    open: async () => Readable.from([bytes]),
  };
}

export function archiveResponse({
  plan,
  filename,
  onFinish,
}: {
  plan: ZipPlan;
  filename: string;
  /** With the bytes that really went out, once the body has terminated. */
  onFinish?: (bytesServed: bigint, complete: boolean) => Promise<void>;
}): Response {
  const { metered, served } = meterStream(zipStream(plan));

  if (onFinish) {
    // Subscribed now, while the stream is live; see lib/download.ts for why
    // subscribing inside `after` would wait forever.
    const finished = new Promise<void>((resolve) => {
      metered.once("close", resolve);
    });

    after(async () => {
      await finished;
      await onFinish(served(), served() === plan.totalSize);
    });
  }

  return new Response(Readable.toWeb(metered) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": plan.totalSize.toString(),
      "Content-Disposition": contentDisposition(filename),
      "Accept-Ranges": "none",
      "Cache-Control": "private, no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

/** A filename for the archive: the link's name, else a neutral default. */
export function archiveName(label: string | null | undefined): string {
  const base = (label ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .trim();
  return `${base || "files"}.zip`;
}
