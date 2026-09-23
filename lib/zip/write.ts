import { Readable } from "node:stream";
import { crc32 } from "./crc32";

/**
 * A streaming ZIP writer, for "download everything in this link".
 *
 * Entries are STORED, not deflated. Most of what people share — photos,
 * video, archives, office documents — is already compressed, deflating it
 * again burns CPU on a small box for a few percent, and a stored archive has
 * one more property worth having: its exact length is known before the first
 * byte is written, so the response carries a real Content-Length and the
 * recipient's browser shows real progress on a multi-gigabyte download.
 *
 * Every entry uses a data descriptor (general-purpose bit 3), because the CRC
 * is only known once the bytes have streamed past. ZIP64 is used per entry and
 * for the end records only where a size or offset actually needs it, so a
 * small archive stays readable by the oldest tools.
 *
 * Nothing is buffered beyond one chunk of the entry being copied. The sizes
 * are trusted from the database and then enforced: an object that streams a
 * different number of bytes than its row claims aborts the archive rather than
 * producing one whose offsets lie.
 */

export type ZipEntryInput = {
  /** Path inside the archive, `/`-separated. Sanitised by `planZip`. */
  name: string;
  size: bigint;
  modifiedAt: Date;
  open: () => Promise<Readable>;
};

const MAX_32 = 0xffffffffn;
const MAX_16 = 0xffff;

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const DESCRIPTOR_32 = 16;
const DESCRIPTOR_64 = 24;
const ZIP64_LOCAL_EXTRA = 20; // tag, size, uncompressed, compressed
const ZIP64_CENTRAL_EXTRA = 28; // tag, size, uncompressed, compressed, offset
const EOCD = 22;
const ZIP64_EOCD = 56;
const ZIP64_LOCATOR = 20;

const FLAGS = 0x0808; // bit 3: data descriptor; bit 11: UTF-8 names

type PlannedEntry = ZipEntryInput & {
  nameBytes: Buffer;
  offset: bigint;
  zip64: boolean;
};

export type ZipPlan = {
  entries: PlannedEntry[];
  centralOffset: bigint;
  centralSize: bigint;
  zip64End: boolean;
  totalSize: bigint;
};

/**
 * One path segment made safe to extract anywhere: no traversal, no absolute
 * paths, no control characters, no characters Windows refuses in a filename.
 */
function cleanSegment(segment: string): string {
  const cleaned = Array.from(segment)
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code < 32 || code === 127) return "_";
      if ('<>:"\\|?*'.includes(character)) return "_";
      return character;
    })
    .join("")
    .trim()
    .replace(/[. ]+$/, "");

  return cleaned === "" || cleaned === "." || cleaned === ".." ? "_" : cleaned;
}

export function sanitizeEntryName(name: string): string {
  const segments = name
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .map(cleanSegment);

  return segments.length > 0 ? segments.join("/") : "file";
}

/** "report.pdf", "report (2).pdf", … — case-insensitively, as Windows sees it. */
function dedupe(names: string[]): string[] {
  const taken = new Set<string>();

  return names.map((name) => {
    let candidate = name;
    let n = 2;

    while (taken.has(candidate.toLowerCase())) {
      const slash = name.lastIndexOf("/");
      const dot = name.lastIndexOf(".");
      const hasExtension = dot > slash + 1;
      const stem = hasExtension ? name.slice(0, dot) : name;
      const extension = hasExtension ? name.slice(dot) : "";
      candidate = `${stem} (${n})${extension}`;
      n++;
    }

    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * Lay the archive out before writing it: every offset, which entries need
 * ZIP64, and the exact total length.
 */
export function planZip(
  inputs: ZipEntryInput[],
  { forceZip64 = false }: { forceZip64?: boolean } = {},
): ZipPlan {
  const names = dedupe(inputs.map((entry) => sanitizeEntryName(entry.name)));
  const entries: PlannedEntry[] = [];

  let offset = 0n;

  inputs.forEach((input, index) => {
    const nameBytes = Buffer.from(names[index], "utf8");
    const zip64 = forceZip64 || input.size >= MAX_32 || offset >= MAX_32;

    entries.push({ ...input, name: names[index], nameBytes, offset, zip64 });

    offset +=
      BigInt(
        LOCAL_HEADER + nameBytes.length + (zip64 ? ZIP64_LOCAL_EXTRA : 0),
      ) +
      input.size +
      BigInt(zip64 ? DESCRIPTOR_64 : DESCRIPTOR_32);
  });

  const centralOffset = offset;
  const centralSize = entries.reduce(
    (total, entry) =>
      total +
      BigInt(
        CENTRAL_HEADER +
          entry.nameBytes.length +
          (entry.zip64 ? ZIP64_CENTRAL_EXTRA : 0),
      ),
    0n,
  );

  const zip64End =
    forceZip64 ||
    entries.length >= MAX_16 ||
    centralOffset >= MAX_32 ||
    centralSize >= MAX_32 ||
    entries.some((entry) => entry.zip64);

  const totalSize =
    centralOffset +
    centralSize +
    BigInt(zip64End ? ZIP64_EOCD + ZIP64_LOCATOR : 0) +
    BigInt(EOCD);

  return { entries, centralOffset, centralSize, zip64End, totalSize };
}

/** DOS date and time, the only clock ZIP's core headers know. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));

  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
    date:
      ((year - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
  };
}

function localHeader(entry: PlannedEntry): Buffer {
  const extra = entry.zip64 ? ZIP64_LOCAL_EXTRA : 0;
  const header = Buffer.alloc(LOCAL_HEADER + entry.nameBytes.length + extra);
  const { time, date } = dosDateTime(entry.modifiedAt);

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(entry.zip64 ? 45 : 20, 4);
  header.writeUInt16LE(FLAGS, 6);
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(0, 14); // CRC follows in the data descriptor
  header.writeUInt32LE(entry.zip64 ? 0xffffffff : 0, 18);
  header.writeUInt32LE(entry.zip64 ? 0xffffffff : 0, 22);
  header.writeUInt16LE(entry.nameBytes.length, 26);
  header.writeUInt16LE(extra, 28);
  entry.nameBytes.copy(header, LOCAL_HEADER);

  if (entry.zip64) {
    const at = LOCAL_HEADER + entry.nameBytes.length;
    header.writeUInt16LE(0x0001, at);
    header.writeUInt16LE(16, at + 2);
    header.writeBigUInt64LE(entry.size, at + 4);
    header.writeBigUInt64LE(entry.size, at + 12);
  }

  return header;
}

function descriptor(entry: PlannedEntry, crc: number): Buffer {
  const out = Buffer.alloc(entry.zip64 ? DESCRIPTOR_64 : DESCRIPTOR_32);

  out.writeUInt32LE(0x08074b50, 0);
  out.writeUInt32LE(crc, 4);

  if (entry.zip64) {
    out.writeBigUInt64LE(entry.size, 8);
    out.writeBigUInt64LE(entry.size, 16);
  } else {
    out.writeUInt32LE(Number(entry.size), 8);
    out.writeUInt32LE(Number(entry.size), 12);
  }

  return out;
}

function centralHeader(entry: PlannedEntry, crc: number): Buffer {
  const extra = entry.zip64 ? ZIP64_CENTRAL_EXTRA : 0;
  const header = Buffer.alloc(CENTRAL_HEADER + entry.nameBytes.length + extra);
  const { time, date } = dosDateTime(entry.modifiedAt);
  const version = entry.zip64 ? 45 : 20;

  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | version, 4); // made by: Unix
  header.writeUInt16LE(version, 6);
  header.writeUInt16LE(FLAGS, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(entry.zip64 ? 0xffffffff : Number(entry.size), 20);
  header.writeUInt32LE(entry.zip64 ? 0xffffffff : Number(entry.size), 24);
  header.writeUInt16LE(entry.nameBytes.length, 28);
  header.writeUInt16LE(extra, 30);
  header.writeUInt16LE(0, 32); // comment
  header.writeUInt16LE(0, 34); // disk
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
  header.writeUInt32LE(entry.zip64 ? 0xffffffff : Number(entry.offset), 42);
  entry.nameBytes.copy(header, CENTRAL_HEADER);

  if (entry.zip64) {
    const at = CENTRAL_HEADER + entry.nameBytes.length;
    header.writeUInt16LE(0x0001, at);
    header.writeUInt16LE(24, at + 2);
    header.writeBigUInt64LE(entry.size, at + 4);
    header.writeBigUInt64LE(entry.size, at + 12);
    header.writeBigUInt64LE(entry.offset, at + 20);
  }

  return header;
}

function endRecords(plan: ZipPlan): Buffer {
  const count = plan.entries.length;
  const parts: Buffer[] = [];

  if (plan.zip64End) {
    const record = Buffer.alloc(ZIP64_EOCD);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(BigInt(ZIP64_EOCD - 12), 4);
    record.writeUInt16LE((3 << 8) | 45, 12);
    record.writeUInt16LE(45, 14);
    record.writeUInt32LE(0, 16);
    record.writeUInt32LE(0, 20);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(plan.centralSize, 40);
    record.writeBigUInt64LE(plan.centralOffset, 48);

    const locator = Buffer.alloc(ZIP64_LOCATOR);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(plan.centralOffset + plan.centralSize, 8);
    locator.writeUInt32LE(1, 16);

    parts.push(record, locator);
  }

  const end = Buffer.alloc(EOCD);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(plan.zip64End ? MAX_16 : count, 8);
  end.writeUInt16LE(plan.zip64End ? MAX_16 : count, 10);
  end.writeUInt32LE(plan.zip64End ? 0xffffffff : Number(plan.centralSize), 12);
  end.writeUInt32LE(
    plan.zip64End ? 0xffffffff : Number(plan.centralOffset),
    16,
  );
  end.writeUInt16LE(0, 20);
  parts.push(end);

  return Buffer.concat(parts);
}

/**
 * Stream a planned archive. The returned Readable pulls each entry's bytes
 * only when the consumer asks, so a slow recipient holds one open object at a
 * time, not every file in the link.
 */
export function zipStream(plan: ZipPlan): Readable {
  async function* generate() {
    const crcs: number[] = [];

    for (const entry of plan.entries) {
      yield localHeader(entry);

      const source = await entry.open();
      let crc = 0;
      let written = 0n;

      try {
        for await (const chunk of source) {
          const bytes: Buffer = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk);
          crc = crc32(bytes, crc);
          written += BigInt(bytes.length);

          if (written > entry.size) {
            throw new Error(`${entry.name} is longer than its recorded size`);
          }

          yield bytes;
        }
      } finally {
        source.destroy();
      }

      if (written !== entry.size) {
        throw new Error(
          `${entry.name} ended at ${written} bytes; its row says ${entry.size}`,
        );
      }

      crcs.push(crc);
      yield descriptor(entry, crc);
    }

    const central = plan.entries.map((entry, index) =>
      centralHeader(entry, crcs[index]),
    );

    yield Buffer.concat(central);
    yield endRecords(plan);
  }

  return Readable.from(generate(), { objectMode: false });
}
