import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { hashStream } from "./checksum";

function oneShot(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("hashStream", () => {
  test("matches a one-shot hash of the same bytes", async () => {
    const data = Buffer.from("the quick brown fox");

    expect(await hashStream(Readable.from(data))).toBe(oneShot(data));
  });

  test("is unaffected by how the stream is chunked", async () => {
    const data = Buffer.from(
      Array.from({ length: 64 * 1024 }, (_, i) => i % 251),
    );
    const digests = new Set<string>();

    for (const size of [1, 7, 1024, 65536]) {
      const chunks: Buffer[] = [];
      for (let at = 0; at < data.length; at += size) {
        chunks.push(data.subarray(at, at + size));
      }
      digests.add(await hashStream(Readable.from(chunks)));
    }

    expect(digests.size).toBe(1);
    expect([...digests][0]).toBe(oneShot(data));
  });

  test("hashes an empty stream", async () => {
    expect(await hashStream(Readable.from([]))).toBe(oneShot(Buffer.alloc(0)));
  });

  test("rejects on a stream error instead of returning a partial digest", async () => {
    // The important case: a read that dies partway must not produce a digest
    // of the bytes that did arrive, or the worker would store a checksum that
    // permanently disagrees with the file.
    const readable = new Readable({
      read() {
        this.push(Buffer.from("half"));
        this.destroy(new Error("disk went away"));
      },
    });

    expect(hashStream(readable)).rejects.toThrow("disk went away");
  });
});
