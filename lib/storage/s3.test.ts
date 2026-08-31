import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { S3StorageProvider } from "./s3";

/**
 * What the provider asks the bucket for.
 *
 * A real round trip needs a bucket, which a unit test does not have — so this
 * covers the half that is ours: that a byte range becomes the `Range` input on
 * the GET, in the format S3 expects, and that an unranged read still asks for
 * the whole object. Getting the string wrong would not fail loudly; it would
 * quietly serve the wrong bytes.
 */
function withStubbedClient(provider: S3StorageProvider) {
  const sent: { Bucket?: string; Key?: string; Range?: string }[] = [];

  (
    provider as unknown as { client: { send: (c: unknown) => unknown } }
  ).client = {
    send: (command: unknown) => {
      sent.push((command as { input: { Range?: string } }).input);
      return Promise.resolve({ Body: Readable.from([Buffer.from("xy")]) });
    },
  };

  return sent;
}

describe("S3StorageProvider.stream", () => {
  test("asks for the whole object when given no range", async () => {
    const provider = new S3StorageProvider({ bucket: "b" });
    const sent = withStubbedClient(provider);

    await provider.stream("k");

    expect(sent[0].Bucket).toBe("b");
    expect(sent[0].Key).toBe("k");
    expect(sent[0].Range).toBeUndefined();
  });

  test("turns a range into an inclusive bytes= header", async () => {
    const provider = new S3StorageProvider({ bucket: "b" });
    const sent = withStubbedClient(provider);

    await provider.stream("k", { start: 0, end: 99 });

    // Inclusive at both ends, exactly as HTTP and our ByteRange mean it.
    expect(sent[0].Range).toBe("bytes=0-99");
  });

  test("a single-byte range is not collapsed", async () => {
    const provider = new S3StorageProvider({ bucket: "b" });
    const sent = withStubbedClient(provider);

    await provider.stream("k", { start: 5, end: 5 });

    expect(sent[0].Range).toBe("bytes=5-5");
  });

  test("a suffix range is already resolved to absolute offsets", async () => {
    // lib/range.ts converts `bytes=-16` before it ever reaches storage, so the
    // provider never has to understand the suffix form.
    const provider = new S3StorageProvider({ bucket: "b" });
    const sent = withStubbedClient(provider);

    await provider.stream("k", { start: 1024, end: 1039 });

    expect(sent[0].Range).toBe("bytes=1024-1039");
  });
});
