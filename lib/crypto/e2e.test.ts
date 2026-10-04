import { describe, expect, test } from "bun:test";
import {
  CHUNK_SIZE,
  decryptToBlob,
  deriveKey,
  encryptFile,
  fromBase64Url,
  generateKey,
  IntegrityError,
  importKey,
  randomBytes,
  toBase64Url,
} from "./e2e";

/** Magic, file id, chunk size, length: what precedes the first frame. */
const HEADER = 32;

/** The [prefix][IV][ciphertext] frames after the header, as byte ranges. */
function frames(bytes: Uint8Array, from = HEADER) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Array<{ start: number; end: number }> = [];
  let offset = from;

  while (offset < bytes.byteLength) {
    const end = offset + 4 + 12 + view.getUint32(offset, false);
    found.push({ start: offset, end });
    offset = end;
  }

  return found;
}

function concat(...pieces: Uint8Array[]): ArrayBuffer {
  const out = new Uint8Array(pieces.reduce((n, piece) => n + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    out.set(piece, offset);
    offset += piece.length;
  }
  return out.buffer;
}

/** The pre-header format, built by hand: bare frames, no AAD. */
async function legacyEncrypt(plain: Uint8Array, key: CryptoKey) {
  const pieces: Uint8Array[] = [];

  for (let offset = 0; offset < plain.length; offset += CHUNK_SIZE) {
    const iv = randomBytes(12);
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        plain.subarray(offset, offset + CHUNK_SIZE) as BufferSource,
      ),
    );
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, cipher.length, false);
    pieces.push(prefix, iv, cipher);
  }

  return concat(...pieces);
}

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

    const ivs = frames(bytes).map(({ start }) =>
      toBase64Url(bytes.subarray(start + 4, start + 16)),
    );

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

    const [one, two] = frames(bytes);
    const first = bytes.subarray(one.start + 16, one.start + 16 + 1024);
    const second = bytes.subarray(two.start + 16, two.start + 16 + 1024);

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

    // Flip one bit well past the header, the length, and the IV.
    bytes[HEADER + 64] ^= 0x01;

    await expect(
      decryptToBlob(bytes.buffer as ArrayBuffer, key, "text/plain"),
    ).rejects.toThrow();
  });

  test("a tampered IV is rejected", async () => {
    const { key } = await generateKey();
    const blob = await encryptFile(fileOf(randomBytes(512)), key);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    bytes[HEADER + 4] ^= 0x01;

    await expect(
      decryptToBlob(bytes.buffer as ArrayBuffer, key, "text/plain"),
    ).rejects.toThrow();
  });
});

describe("the file as a whole", () => {
  // Two full chunks and a short third, so there is an order to break.
  async function sealed() {
    const { key } = await generateKey();
    const plain = randomBytes(CHUNK_SIZE * 2 + 3);
    const bytes = new Uint8Array(
      await (await encryptFile(fileOf(plain), key)).arrayBuffer(),
    );
    return { key, plain, bytes, parts: frames(bytes) };
  }

  function piece(bytes: Uint8Array, range: { start: number; end: number }) {
    return bytes.subarray(range.start, range.end);
  }

  async function refused(data: ArrayBuffer, key: CryptoKey) {
    await expect(
      decryptToBlob(data, key, "application/octet-stream"),
    ).rejects.toThrow();
  }

  test("a missing final chunk is refused, not handed over short", async () => {
    const { key, bytes, parts } = await sealed();
    await refused(bytes.slice(0, parts[1].end).buffer, key);
  });

  test("reordered chunks are refused", async () => {
    const { key, bytes, parts } = await sealed();
    const head = bytes.subarray(0, HEADER);

    await refused(
      concat(
        head,
        piece(bytes, parts[1]),
        piece(bytes, parts[0]),
        piece(bytes, parts[2]),
      ),
      key,
    );
  });

  test("a chunk repeated in place of another is refused", async () => {
    const { key, bytes, parts } = await sealed();
    const head = bytes.subarray(0, HEADER);

    await refused(
      concat(
        head,
        piece(bytes, parts[0]),
        piece(bytes, parts[0]),
        piece(bytes, parts[2]),
      ),
      key,
    );
  });

  test("trailing bytes are refused", async () => {
    const { key, bytes } = await sealed();
    await refused(concat(bytes, Uint8Array.of(0)), key);
  });

  test("a header claiming a different length is refused", async () => {
    const { key, bytes, parts } = await sealed();
    const forged = bytes.slice(0, parts[1].end);
    // Claim exactly two chunks, so the framing itself is consistent and only
    // the tags can tell.
    new DataView(forged.buffer).setBigUint64(24, BigInt(CHUNK_SIZE * 2), false);

    await refused(forged.buffer, key);
  });

  test("a chunk from another file under the same key is refused", async () => {
    const { key, bytes, parts } = await sealed();
    const other = new Uint8Array(
      await (
        await encryptFile(fileOf(randomBytes(CHUNK_SIZE * 2 + 3)), key)
      ).arrayBuffer(),
    );
    const otherParts = frames(other);

    await refused(
      concat(
        bytes.subarray(0, parts[1].start),
        piece(other, otherParts[1]),
        piece(bytes, parts[2]),
      ),
      key,
    );
  });

  test("nothing at all is not an empty file", async () => {
    const { key } = await generateKey();

    await expect(
      decryptToBlob(new ArrayBuffer(0), key, "text/plain"),
    ).rejects.toThrow(IntegrityError);
  });

  test("an empty file still round-trips, carrying a tag of its own", async () => {
    const { key } = await generateKey();
    const bytes = new Uint8Array(
      await (await encryptFile(fileOf(new Uint8Array(0)), key)).arrayBuffer(),
    );

    expect(bytes.byteLength).toBe(HEADER + 4 + 12 + 16);
    expect((await decryptToBlob(bytes.buffer, key, "text/plain")).size).toBe(0);
  });
});

describe("files from before the header", () => {
  test("still decrypt", async () => {
    const { key } = await generateKey();
    const plain = randomBytes(CHUNK_SIZE + 5);

    expect(
      await bytesOf(
        await decryptToBlob(await legacyEncrypt(plain, key), key, "text/plain"),
      ),
    ).toEqual(plain);
  });

  test("cannot be forged from a new file's chunks", async () => {
    // The chunks' tags cover their header, so dressing them as bare legacy
    // frames — dropping the one at the end — does not decrypt.
    const { key } = await generateKey();
    const bytes = new Uint8Array(
      await (
        await encryptFile(fileOf(randomBytes(CHUNK_SIZE + 5)), key)
      ).arrayBuffer(),
    );
    const [first] = frames(bytes);

    await expect(
      decryptToBlob(
        bytes.slice(first.start, first.end).buffer,
        key,
        "text/plain",
      ),
    ).rejects.toThrow();
  });
});
