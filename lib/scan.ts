import { connect } from "node:net";
import type { Readable } from "node:stream";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { storage } from "@/lib/storage";

/**
 * Optional malware scanning through ClamAV.
 *
 * A reverse share accepts files from anyone holding a link, and a send share
 * hands files to people who trust the sender. Neither is a place to pass
 * along something known-bad. When `CLAMAV_HOST` is set, every upload the
 * server can read is streamed to clamd's INSTREAM command by the SCAN_FILE
 * job, and a file it recognises is marked INFECTED — after which no public
 * route will serve it (lib/shares/request.ts, `publiclyServable`).
 *
 * clamd rather than a library: it is the standard sidecar, its signatures
 * update themselves, and the protocol is small enough to speak directly —
 * which keeps a second native dependency out of the image.
 *
 * What this is not: a guarantee. Signature scanning catches known malware,
 * and an E2E file is ciphertext that no scanner can read. The interface says
 * "no known threats", never "safe".
 */

export function scannerConfigured(): boolean {
  return Boolean(process.env.CLAMAV_HOST?.trim());
}

/** clamd's StreamMaxLength default is 25 MB; larger files are skipped, not failed. */
function maxScanBytes(): number {
  const configured = Number(process.env.CLAMAV_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : 25 * 1024 * 1024;
}

export type ScanVerdict =
  | { status: "CLEAN" }
  | { status: "INFECTED"; signature: string };

/**
 * Parse clamd's one-line reply. Split out so the protocol's quirks — the
 * `stream:` prefix, the trailing NUL, the size-limit error — are tested
 * without a daemon.
 */
export function parseClamdReply(reply: string): ScanVerdict {
  const text = reply.replace(/\0/g, "").trim();

  if (/:\s*OK$/.test(text)) return { status: "CLEAN" };

  const found = /:\s*(.+)\s+FOUND$/.exec(text);
  if (found) return { status: "INFECTED", signature: found[1].trim() };

  throw new Error(`clamd: ${text || "empty reply"}`);
}

/**
 * INSTREAM: `zINSTREAM\0`, then length-prefixed chunks, then a zero length.
 * Backpressure is respected so a large file does not queue in memory while
 * clamd reads.
 */
export function scanStream(
  source: Readable,
  {
    host,
    port,
    timeoutMs = 120_000,
  }: { host: string; port: number; timeoutMs?: number },
): Promise<ScanVerdict> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    let settled = false;

    const finish = (error: Error | null, verdict?: ScanVerdict) => {
      if (settled) return;
      settled = true;
      source.destroy();
      socket.destroy();
      if (error) reject(error);
      else if (verdict) resolve(verdict);
    };

    socket.setTimeout(timeoutMs, () =>
      finish(new Error("clamd did not answer in time")),
    );
    socket.on("error", (error) => finish(error));
    socket.on("data", (data) => chunks.push(data));
    socket.on("end", () => {
      try {
        finish(null, parseClamdReply(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        finish(error as Error);
      }
    });

    socket.on("connect", async () => {
      try {
        socket.write("zINSTREAM\0");

        for await (const chunk of source) {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const header = Buffer.alloc(4);
          header.writeUInt32BE(data.length, 0);

          if (!socket.write(Buffer.concat([header, data]))) {
            await new Promise((drained) => socket.once("drain", drained));
          }
        }

        socket.write(Buffer.alloc(4));
      } catch (error) {
        finish(error as Error);
      }
    });
  });
}

export async function scanJob(payload: { fileId: string }): Promise<void> {
  if (!scannerConfigured()) return;

  const file = await db.file.findUnique({
    where: { id: payload.fileId },
    select: {
      id: true,
      storageKey: true,
      size: true,
      isEncrypted: true,
      scanStatus: true,
    },
  });

  if (!file || file.scanStatus === "CLEAN" || file.scanStatus === "INFECTED") {
    return;
  }

  if (file.isEncrypted) {
    await db.file.update({
      where: { id: file.id },
      data: {
        scanStatus: "SKIPPED",
        scanDetail: "end-to-end encrypted; the scanner sees only ciphertext",
      },
    });
    return;
  }

  if (file.size > BigInt(maxScanBytes())) {
    await db.file.update({
      where: { id: file.id },
      data: {
        scanStatus: "SKIPPED",
        scanDetail: "larger than the scanner accepts (CLAMAV_MAX_BYTES)",
      },
    });
    return;
  }

  let verdict: ScanVerdict;

  try {
    verdict = await scanStream(await storage.stream(file.storageKey), {
      host: process.env.CLAMAV_HOST?.trim() ?? "",
      port: Number(process.env.CLAMAV_PORT ?? 3310),
    });
  } catch (error) {
    // Recorded so the file does not read as "not scanned" forever once the
    // worker gives up, then rethrown so it does get its retries. A later
    // success overwrites this.
    await db.file.update({
      where: { id: file.id },
      data: {
        scanStatus: "FAILED",
        scanDetail: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }

  await db.file.update({
    where: { id: file.id },
    data:
      verdict.status === "CLEAN"
        ? { scanStatus: "CLEAN", scanDetail: null }
        : { scanStatus: "INFECTED", scanDetail: verdict.signature },
  });

  if (verdict.status === "INFECTED") {
    log.warn("scan.infected", {
      fileId: file.id,
      signature: verdict.signature,
    });
  }
}
