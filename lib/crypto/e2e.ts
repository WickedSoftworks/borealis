/**
 * Zero-knowledge share encryption.
 *
 * Files are encrypted in the browser with AES-GCM before a single byte reaches
 * the server, and decrypted in the recipient's browser. The server stores
 * ciphertext plus a salt and IV; it never receives the key and cannot derive
 * one, so it cannot read the file at any privilege level, root included.
 *
 * Two ways to carry the key, both keeping it off the wire:
 *
 *   fragment — a random key encoded in the URL's #fragment. Browsers never
 *              send fragments in requests, so the link works for anyone who
 *              has it while the server sees only the path.
 *
 *   password — the key is derived from a passphrase with PBKDF2. Nothing about
 *              the key travels at all, not even in the link. This is strictly
 *              stronger than the ordinary share password, where the server
 *              verifies a hash and therefore sees the password.
 *
 * The file is encrypted in chunks so a multi-gigabyte upload never has to sit
 * in memory whole. Each chunk's tag also covers a header naming the file and
 * its length, the chunk's position, and whether it is the last — see
 * encryptFile for why a valid tag on every chunk was not enough.
 */

const CHUNK_SIZE = 4 * 1024 * 1024;
const PBKDF2_ITERATIONS = 310_000;

export type EncryptionMeta = {
  algorithm: "AES-GCM";
  /** Absent on files from before the framed format; see encryptFile. */
  version?: 2;
  mode: "fragment" | "password";
  chunkSize: number;
  /** base64url PBKDF2 salt. Password mode only; a fragment key needs neither. */
  salt?: string;
  iterations?: number;
};

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** A fresh 256-bit key, exported for the URL fragment. */
export async function generateKey(): Promise<{
  key: CryptoKey;
  encoded: string;
}> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));

  return { key, encoded: toBase64Url(raw) };
}

export async function importKey(encoded: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    fromBase64Url(encoded) as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Derive the key from a passphrase, so it never leaves the browser at all. */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** "BRL" and the format version, opening every file in the framed format. */
const MAGIC = Uint8Array.of(0x42, 0x52, 0x4c, 0x02);
/** Magic, a random file id, the chunk size, the plaintext length. */
const HEADER_BYTES = 4 + 16 + 4 + 8;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** A frame's own length prefix, before its IV and ciphertext. */
const FRAME_PREFIX_BYTES = 4;

/** Thrown when what arrived is not, whole and in order, what was encrypted. */
export class IntegrityError extends Error {
  constructor(message = "This file was altered or is incomplete.") {
    super(message);
    this.name = "IntegrityError";
  }
}

function header(fileId: Uint8Array, chunkSize: number, length: number) {
  const bytes = new Uint8Array(HEADER_BYTES);
  const view = new DataView(bytes.buffer);

  bytes.set(MAGIC, 0);
  bytes.set(fileId, 4);
  view.setUint32(20, chunkSize, false);
  view.setBigUint64(24, BigInt(length), false);

  return bytes;
}

/** What each chunk's tag covers besides its ciphertext. */
function chunkAad(head: Uint8Array, index: number, last: boolean) {
  const aad = new Uint8Array(HEADER_BYTES + 5);

  aad.set(head, 0);
  new DataView(aad.buffer).setUint32(HEADER_BYTES, index, false);
  aad[HEADER_BYTES + 4] = last ? 1 : 0;

  return aad;
}

function chunkCount(length: number, chunkSize: number) {
  // An empty file is still one (empty, last) chunk, so even it carries a tag
  // and an empty response can never pass for it.
  return Math.max(1, Math.ceil(length / chunkSize));
}

/**
 * Encrypt a file into a Blob: a header, then one
 * [4-byte length][12-byte IV][ciphertext] frame per chunk.
 *
 * Each chunk gets its own IV — reusing one across chunks under the same key
 * would leak plaintext relationships. And each chunk's tag covers the header
 * (a random file id, the chunk size, the total length), the chunk's index,
 * and whether it is the last, the same shape as the STREAM construction that
 * Tink and age use.
 *
 * Without that, every chunk authenticated only itself. A host could drop the
 * final chunk, reorder chunks, or serve nothing at all, and the recipient got
 * a "successfully decrypted" file that was not the one sent; a checksum the
 * server computes cannot catch a server that rewrites both.
 */
export async function encryptFile(
  file: File,
  key: CryptoKey,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const head = header(randomBytes(16), CHUNK_SIZE, file.size);
  const count = chunkCount(file.size, CHUNK_SIZE);
  const parts: BlobPart[] = [head.buffer as ArrayBuffer];

  for (let index = 0; index < count; index++) {
    const offset = index * CHUNK_SIZE;
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const plain = new Uint8Array(await slice.arrayBuffer());
    const iv = randomBytes(IV_BYTES);

    const cipher = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv as BufferSource,
          additionalData: chunkAad(head, index, index === count - 1),
        },
        key,
        plain as BufferSource,
      ),
    );

    const prefix = new Uint8Array(FRAME_PREFIX_BYTES);
    new DataView(prefix.buffer).setUint32(0, cipher.byteLength, false);

    // Copy into fresh ArrayBuffer-backed views: getRandomValues and the WebCrypto
    // result are typed as ArrayBufferLike, which BlobPart does not accept.
    parts.push(
      prefix.buffer as ArrayBuffer,
      new Uint8Array(iv).buffer as ArrayBuffer,
      cipher.buffer as ArrayBuffer,
    );

    onProgress?.(Math.min(offset + CHUNK_SIZE, file.size), file.size);
  }

  return new Blob(parts, { type: "application/octet-stream" });
}

function startsWithMagic(bytes: Uint8Array) {
  return (
    bytes.byteLength >= MAGIC.byteLength &&
    MAGIC.every((byte, index) => bytes[index] === byte)
  );
}

/**
 * Reverse of encryptFile. Throws if the key is wrong — GCM authenticates —
 * and throws IntegrityError if the file arrived cut short, reordered, padded,
 * or replaced.
 */
export async function decryptToBlob(
  data: ArrayBuffer,
  key: CryptoKey,
  mimeType: string,
): Promise<Blob> {
  const bytes = new Uint8Array(data);

  const parts = startsWithMagic(bytes)
    ? await decryptFramed(bytes, key)
    : await decryptLegacy(bytes, key);

  return new Blob(parts, { type: mimeType });
}

async function decryptFramed(bytes: Uint8Array, key: CryptoKey) {
  if (bytes.byteLength < HEADER_BYTES) throw new IntegrityError();

  const head = bytes.subarray(0, HEADER_BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkSize = view.getUint32(20, false);
  const length = Number(view.getBigUint64(24, false));

  if (chunkSize === 0 || !Number.isSafeInteger(length)) {
    throw new IntegrityError();
  }

  // The header is only a claim until the first tag checks it, but it decides
  // how many chunks to expect and how big each must be — so a file that ends
  // early, runs long, or has a frame of the wrong size fails here rather than
  // decrypting into something shorter.
  const count = chunkCount(length, chunkSize);
  const parts: BlobPart[] = [];
  let offset = HEADER_BYTES;

  for (let index = 0; index < count; index++) {
    const last = index === count - 1;
    const plainLength = last ? length - index * chunkSize : chunkSize;

    if (offset + FRAME_PREFIX_BYTES + IV_BYTES > bytes.byteLength) {
      throw new IntegrityError();
    }

    const cipherLength = view.getUint32(offset, false);
    offset += FRAME_PREFIX_BYTES;

    if (cipherLength !== plainLength + TAG_BYTES) throw new IntegrityError();

    const iv = bytes.subarray(offset, offset + IV_BYTES);
    offset += IV_BYTES;

    if (offset + cipherLength > bytes.byteLength) throw new IntegrityError();

    const cipher = bytes.subarray(offset, offset + cipherLength);
    offset += cipherLength;

    parts.push(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv as BufferSource,
          additionalData: chunkAad(head, index, last),
        },
        key,
        cipher as BufferSource,
      ),
    );
  }

  if (offset !== bytes.byteLength) throw new IntegrityError();

  return parts;
}

/**
 * Files encrypted before the framed format: bare frames, each authenticating
 * only itself. They still decrypt, with their old guarantees and no more — a
 * host could drop trailing chunks or reorder them undetected. The one thing
 * refused now is nothing at all: an empty response is what a deleted or
 * truncated file looks like, so it is not handed over as an empty file.
 */
async function decryptLegacy(bytes: Uint8Array, key: CryptoKey) {
  if (bytes.byteLength === 0) {
    throw new IntegrityError("The server sent nothing for this file.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: BlobPart[] = [];
  let offset = 0;

  while (offset < bytes.byteLength) {
    if (offset + FRAME_PREFIX_BYTES + IV_BYTES > bytes.byteLength) {
      throw new IntegrityError();
    }

    const length = view.getUint32(offset, false);
    offset += FRAME_PREFIX_BYTES;

    const iv = bytes.subarray(offset, offset + IV_BYTES);
    offset += IV_BYTES;

    if (length > CHUNK_SIZE + TAG_BYTES || offset + length > bytes.byteLength) {
      throw new IntegrityError();
    }

    const cipher = bytes.subarray(offset, offset + length);
    offset += length;

    parts.push(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        cipher as BufferSource,
      ),
    );
  }

  return parts;
}

export { CHUNK_SIZE, fromBase64Url, PBKDF2_ITERATIONS, toBase64Url };
