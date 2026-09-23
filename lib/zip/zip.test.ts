import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { deflateRawSync } from "node:zlib";
import { crc32 } from "./crc32";
import { listEntries, readEntry } from "./read";
import {
  planZip,
  sanitizeEntryName,
  type ZipEntryInput,
  zipStream,
} from "./write";

function entry(name: string, body: string | Buffer): ZipEntryInput {
  const bytes = typeof body === "string" ? Buffer.from(body) : body;

  return {
    name,
    size: BigInt(bytes.length),
    modifiedAt: new Date("2026-09-22T12:34:56Z"),
    // Split into several chunks so the CRC is exercised incrementally.
    open: async () =>
      Readable.from([bytes.subarray(0, 3), bytes.subarray(3)], {
        objectMode: false,
      }),
  };
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("crc32", () => {
  test("matches the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  test("is the same computed in pieces as in one go", () => {
    const whole = Buffer.from("the quick brown fox jumps over the lazy dog");
    const split = crc32(whole.subarray(10), crc32(whole.subarray(0, 10)));
    expect(split).toBe(crc32(whole));
  });
});

describe("sanitizeEntryName", () => {
  test("keeps folders, drops traversal and absolute paths", () => {
    expect(sanitizeEntryName("photos/2024/a.jpg")).toBe("photos/2024/a.jpg");
    expect(sanitizeEntryName("../../etc/passwd")).toBe("_/_/etc/passwd");
    expect(sanitizeEntryName("/abs/path.txt")).toBe("abs/path.txt");
    expect(sanitizeEntryName("C:\\Windows\\x.dll")).toBe("C_/Windows/x.dll");
  });

  test("replaces characters Windows refuses and control characters", () => {
    expect(sanitizeEntryName('a<b>c:d"e|f?g*h\u0001.txt')).toBe(
      "a_b_c_d_e_f_g_h_.txt",
    );
  });

  test("an empty name still produces an entry", () => {
    expect(sanitizeEntryName("")).toBe("file");
    expect(sanitizeEntryName("...")).toBe("_");
  });
});

describe("planZip", () => {
  test("dedupes names case-insensitively, keeping extensions", () => {
    const plan = planZip([
      entry("Report.pdf", "a"),
      entry("report.pdf", "b"),
      entry("report.pdf", "c"),
      entry("notes", "d"),
      entry("notes", "e"),
    ]);

    expect(plan.entries.map((e) => e.name)).toEqual([
      "Report.pdf",
      "report (2).pdf",
      "report (3).pdf",
      "notes",
      "notes (2)",
    ]);
  });

  test("switches to ZIP64 only for the entry that needs it", () => {
    const huge = 5n * 1024n ** 3n;
    const plan = planZip([
      { ...entry("small.txt", "x"), size: 1n },
      { ...entry("huge.bin", "x"), size: huge },
      { ...entry("after.txt", "x"), size: 1n },
    ]);

    expect(plan.entries.map((e) => e.zip64)).toEqual([false, true, true]);
    expect(plan.zip64End).toBe(true);
    // The third entry starts past 4 GiB, so its offset needs ZIP64 too.
    expect(plan.entries[2].offset > 0xffffffffn).toBe(true);
  });

  test("a small archive stays plain ZIP", () => {
    const plan = planZip([entry("a.txt", "hello")]);
    expect(plan.zip64End).toBe(false);
  });
});

describe("zipStream", () => {
  const inputs = () => [
    entry("hello.txt", "Hello, world!\n"),
    entry("folder/nested/π.txt", "unicode names survive"),
    entry("empty.txt", ""),
  ];

  for (const forceZip64 of [false, true]) {
    test(`round-trips through the reader${forceZip64 ? " as ZIP64" : ""}`, async () => {
      const plan = planZip(inputs(), { forceZip64 });
      const archive = await collect(zipStream(plan));

      // The promised length is the real length — this is what the download
      // route puts in Content-Length.
      expect(BigInt(archive.length)).toBe(plan.totalSize);

      const entries = listEntries(archive);
      expect(entries.map((e) => e.name)).toEqual([
        "hello.txt",
        "folder/nested/π.txt",
        "empty.txt",
      ]);

      expect((await readEntry(archive, entries[0])).toString()).toBe(
        "Hello, world!\n",
      );
      expect((await readEntry(archive, entries[1])).toString()).toBe(
        "unicode names survive",
      );
      expect((await readEntry(archive, entries[2])).length).toBe(0);
    });
  }

  test("an object shorter than its row aborts the archive", async () => {
    const lying = { ...entry("short.bin", "abc"), size: 10n };
    await expect(collect(zipStream(planZip([lying])))).rejects.toThrow(
      /ended at 3 bytes/,
    );
  });

  test("an object longer than its row aborts the archive", async () => {
    const lying = { ...entry("long.bin", "abcdefgh"), size: 2n };
    await expect(collect(zipStream(planZip([lying])))).rejects.toThrow(
      /longer than its recorded size/,
    );
  });
});

describe("readEntry", () => {
  /** A one-entry DEFLATE archive, built by hand the way Office writes them. */
  function deflated(name: string, content: Buffer): Buffer {
    const compressed = deflateRawSync(content);
    const nameBytes = Buffer.from(name);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(content), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(content), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(0, 42);

    const centralOffset = 30 + nameBytes.length + compressed.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + nameBytes.length, 12);
    end.writeUInt32LE(centralOffset, 16);

    return Buffer.concat([
      local,
      nameBytes,
      compressed,
      central,
      nameBytes,
      end,
    ]);
  }

  test("inflates DEFLATE entries", async () => {
    const text = Buffer.from("<w:t>indexed</w:t>".repeat(100));
    const archive = deflated("word/document.xml", text);
    const [only] = listEntries(archive);

    expect((await readEntry(archive, only)).equals(text)).toBe(true);
  });

  test("stops a zip bomb at the limit, keeping what fitted", async () => {
    const bomb = deflated("bomb.xml", Buffer.alloc(8 * 1024 * 1024, 0x41));
    const [only] = listEntries(bomb);
    const out = await readEntry(bomb, only, 1024);

    expect(out.length).toBe(1024);
    expect(out.every((byte) => byte === 0x41)).toBe(true);
  });

  test("refuses something that is not an archive", () => {
    expect(() => listEntries(Buffer.from("plain text, no zip here"))).toThrow();
  });
});
