import { describe, expect, test } from "bun:test";
import {
  CHUNK_SIZE,
  decryptToBlob,
  deriveKey,
  encryptFile,
  fromBase64Url,
  generateKey,
  importKey,
  randomBytes,
  toBase64Url,
} from "./e2e";

function fileOf(bytes: Uint8Array, name = "payload.bin"): File {
  return new File([bytes as BufferSource], name, {
    type: "application/octet-stream",
  });
}

/** Widened to plain `Uint8Array` so comparisons don't trip on ArrayBufferLike. */
async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

async function roundTrip(
  plain: Uint8Array,
  key: CryptoKey,
): Promise<Uint8Array> {
  const blob = await encryptFile(fileOf(plain), key);

  return bytesOf(
    await decryptToBlob(
      await blob.arrayBuffer(),
      key,
      "application/octet-stream",
    ),
  );
}

describe("base64url", () => {
  test("round-trips arbitrary bytes, including ones needing padding", () => {
    for (const length of [1, 2, 3, 16, 31, 32]) {
      const bytes = randomBytes(length);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  test("emits nothing that would be mangled in a URL fragment", () => {
    const encoded = toBase64Url(randomBytes(32));
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("fragment mode", () => {
  test("a key survives export to the fragment and back", async () => {
    const { key, encoded } = await generateKey();
    const plain = randomBytes(1024);

    const blob = await encryptFile(fileOf(plain), key);
    // The recipient only ever has the encoded string from the URL.
    const recovered = await importKey(encoded);
    const out = await decryptToBlob(
      await blob.arrayBuffer(),
      recovered,
      "text/plain",
    );

    expect(await bytesOf(out)).toEqual(plain);
  });

  test("preserves the mime type the recipient is told to expect", async () => {
    const { key } = await generateKey();
    const blob = await encryptFile(fileOf(randomBytes(64)), key);
    const out = await decryptToBlob(await blob.arrayBuffer(), key, "image/png");

    expect(out.type).toBe("image/png");
  });
});

describe("password mode", () => {
  test("the same passphrase and salt derive a usable key", async () => {
    const salt = randomBytes(16);
    const plain = randomBytes(2048);

    const sender = await deriveKey("correct horse battery staple", salt);
    const recipient = await deriveKey("correct horse battery staple", salt);

    const blob = await encryptFile(fileOf(plain), sender);
    const out = await decryptToBlob(
      await blob.arrayBuffer(),
      recipient,
      "text/plain",
    );

    expect(await bytesOf(out)).toEqual(plain);
  });

  test("a different salt yields a different key from the same passphrase", async () => {
    const plain = randomBytes(256);
    const sender = await deriveKey("hunter2hunter2", randomBytes(16));
    const other = await deriveKey("hunter2hunter2", randomBytes(16));

    const blob = await encryptFile(fileOf(plain), sender);

    await expect(
      decryptToBlob(await blob.arrayBuffer(), other, "text/plain"),
    ).rejects.toThrow();
  });
});

describe("chunk framing", () => {
  test("a file spanning several chunks reassembles in order", async () => {
    const { key } = await generateKey();
    // Deliberately not a chunk multiple, so the final frame is a short one.
    const plain = randomBytes(CHUNK_SIZE * 2 + 7919);

    expect(await roundTrip(plain, key)).toEqual(plain);
  });

  test("each chunk gets its own IV", async () => {
    const { key } = await generateKey();
    const blob = await encryptFile(
      fileOf(randomBytes(CHUNK_SIZE * 2 + 1)),
      key,
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);

    const ivs: string[] = [];
    let offset = 0;
    while (offset < bytes.byteLength) {
      const length = view.getUint32(offset, false);
      offset += 4;
      ivs.push(toBase64Url(bytes.subarray(offset, offset + 12)));
      offset += 12 + length;
    }

    expect(ivs).toHaveLength(3);
    expect(new Set(ivs).size).toBe(3);
  });

  test("identical chunks do not produce identical ciphertext", async () => {
    const { key } = await generateKey();
    // Two chunks of the same repeated byte: only per-chunk IVs keep these apart.
    const plain = new Uint8Array(CHUNK_SIZE * 2).fill(0x41);
    const bytes = new Uint8Array(
      await (await encryptFile(fileOf(plain), key)).arrayBuffer(),
    );

    const first = bytes.subarray(16, 16 + 1024);
    const second = bytes.subarray(
      16 + CHUNK_SIZE + 16 + 16,
      16 + CHUNK_SIZE + 16 + 16 + 1024,
    );

    expect(first).not.toEqual(second);
  });

  test("an empty file round-trips to nothing", async () => {
    const { key } = await generateKey();
    expect(await roundTrip(new Uint8Array(0), key)).toEqual(new Uint8Array(0));
  });
});

describe("authentication", () => {
  test("the wrong key is rejected rather than yielding garbage", async () => {
    const { key } = await generateKey();
    const wrong = (await generateKey()).key;
    const blob = await encryptFile(fileOf(randomBytes(1024)), key);

    await expect(
      decryptToBlob(await blob.arrayBuffer(), wrong, "text/plain"),
    ).rejects.toThrow();
  });

  test("tampered ciphertext is rejected", async () => {
    const { key } = await generateKey();
    const blob = await encryptFile(fileOf(randomBytes(1024)), key);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Flip one bit well past the 4-byte length and 12-byte IV.
    bytes[64] ^= 0x01;

    await expect(
      decryptToBlob(bytes.buffer as ArrayBuffer, key, "text/plain"),
    ).rejects.toThrow();
  });

  test("a tampered IV is rejected", async () => {
    const { key } = await generateKey();
    const blob = await encryptFile(fileOf(randomBytes(512)), key);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    bytes[4] ^= 0x01;

    await expect(
      decryptToBlob(bytes.buffer as ArrayBuffer, key, "text/plain"),
    ).rejects.toThrow();
  });
});
