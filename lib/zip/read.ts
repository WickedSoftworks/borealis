import { createInflateRaw } from "node:zlib";

/**
 * A small ZIP reader, for text extraction.
 *
 * XLSX, PPTX, DOCX, ODT, ODS, ODP, and EPUB are all ZIP containers of XML, so
 * one reader turns six formats from "no extractor" into "indexed". It works
 * from the central directory — the authoritative list — handles ZIP64 end
 * records, and inflates DEFLATE entries with zlib.
 *
 * Bounded on purpose. The input is a buffer the extractor already capped, and
 * each entry is inflated with `maxOutputLength`, so a zip bomb — a few
 * kilobytes that inflate to gigabytes — stops at the limit rather than at the
 * end of the heap.
 */

export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
};

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEndRecord(buffer: Buffer): number {
  // The EOCD is 22 bytes plus a comment of at most 65535.
  const floor = Math.max(0, buffer.length - 22 - 0xffff);

  for (let at = buffer.length - 22; at >= floor; at--) {
    if (buffer.readUInt32LE(at) === EOCD_SIG) return at;
  }

  throw new Error("not a zip archive");
}

export function listEntries(buffer: Buffer): ZipEntry[] {
  const end = findEndRecord(buffer);

  let count = buffer.readUInt16LE(end + 10);
  let centralSize = buffer.readUInt32LE(end + 12);
  let centralOffset = buffer.readUInt32LE(end + 16);

  const locator = end - 20;

  if (locator >= 0 && buffer.readUInt32LE(locator) === ZIP64_LOCATOR_SIG) {
    const record = Number(buffer.readBigUInt64LE(locator + 8));

    if (buffer.readUInt32LE(record) === ZIP64_EOCD_SIG) {
      count = Number(buffer.readBigUInt64LE(record + 32));
      centralSize = Number(buffer.readBigUInt64LE(record + 40));
      centralOffset = Number(buffer.readBigUInt64LE(record + 48));
    }
  }

  if (centralOffset + centralSize > buffer.length) {
    throw new Error("truncated zip archive");
  }

  const entries: ZipEntry[] = [];
  let at = centralOffset;

  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(at) !== CENTRAL_SIG) {
      throw new Error("corrupt central directory");
    }

    const method = buffer.readUInt16LE(at + 10);
    let compressedSize = buffer.readUInt32LE(at + 20);
    let size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    let localOffset = buffer.readUInt32LE(at + 42);

    const name = buffer
      .subarray(at + 46, at + 46 + nameLength)
      .toString("utf8");

    // ZIP64 extra: only the fields whose 32-bit slot is saturated are present,
    // in this fixed order.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;

    while (extra + 4 <= extraEnd) {
      const tag = buffer.readUInt16LE(extra);
      const length = buffer.readUInt16LE(extra + 2);

      if (tag === 0x0001) {
        let field = extra + 4;

        if (size === 0xffffffff) {
          size = Number(buffer.readBigUInt64LE(field));
          field += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = Number(buffer.readBigUInt64LE(field));
          field += 8;
        }
        if (localOffset === 0xffffffff) {
          localOffset = Number(buffer.readBigUInt64LE(field));
        }
      }

      extra += 4 + length;
    }

    entries.push({ name, method, compressedSize, size, localOffset });
    at = extraEnd + commentLength;
  }

  return entries;
}

/**
 * Inflate, stopping at `maxBytes` of output. Streamed rather than one-shot so
 * a bomb costs `maxBytes` of memory and then stops: `inflateRawSync` with a
 * `maxOutputLength` only throws, which would lose a legitimately large
 * document's first sixteen megabytes along with the bomb.
 */
function boundedInflate(data: Buffer, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const inflater = createInflateRaw();
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      inflater.destroy();
      resolve(Buffer.concat(chunks, Math.min(total, maxBytes)));
    };

    inflater.on("data", (chunk: Buffer) => {
      if (done) return;
      chunks.push(chunk);
      total += chunk.length;
      if (total >= maxBytes) finish();
    });
    inflater.on("end", finish);
    inflater.on("error", (error) => {
      if (done) return;
      done = true;
      reject(error);
    });

    inflater.end(data);
  });
}

/** One entry's bytes, inflated, never more than `maxBytes` of them. */
export async function readEntry(
  buffer: Buffer,
  entry: ZipEntry,
  maxBytes = 16 * 1024 * 1024,
): Promise<Buffer> {
  const at = entry.localOffset;

  if (buffer.readUInt32LE(at) !== LOCAL_SIG) {
    throw new Error(`corrupt local header for ${entry.name}`);
  }

  const nameLength = buffer.readUInt16LE(at + 26);
  const extraLength = buffer.readUInt16LE(at + 28);
  const start = at + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return data.subarray(0, maxBytes);
  if (entry.method === 8) return boundedInflate(data, maxBytes);

  throw new Error(`unsupported compression method ${entry.method}`);
}

/** Entry lookup by exact name, or by a test over the name. */
export function findEntries(
  entries: ZipEntry[],
  match: string | RegExp,
): ZipEntry[] {
  return entries.filter((entry) =>
    typeof match === "string" ? entry.name === match : match.test(entry.name),
  );
}
