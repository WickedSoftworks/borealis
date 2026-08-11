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
 * in memory whole.
 */

const CHUNK_SIZE = 4 * 1024 * 1024;
const PBKDF2_ITERATIONS = 310_000;

export type EncryptionMeta = {
  algorithm: "AES-GCM";
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

/**
 * Encrypt a file into a Blob laid out as repeated [4-byte length][12-byte IV]
 * [ciphertext] frames. Each chunk gets its own IV — reusing one across chunks
 * under the same key would leak plaintext relationships.
 */
export async function encryptFile(
  file: File,
  key: CryptoKey,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const parts: BlobPart[] = [];
  let offset = 0;

  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const plain = new Uint8Array(await slice.arrayBuffer());
    const iv = randomBytes(12);

    const cipher = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        plain as BufferSource,
      ),
    );

    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, cipher.byteLength, false);

    // Copy into fresh ArrayBuffer-backed views: getRandomValues and the WebCrypto
    // result are typed as ArrayBufferLike, which BlobPart does not accept.
    parts.push(
      header.buffer as ArrayBuffer,
      new Uint8Array(iv).buffer as ArrayBuffer,
      cipher.buffer as ArrayBuffer,
    );
    offset += CHUNK_SIZE;

    onProgress?.(Math.min(offset, file.size), file.size);
  }

  return new Blob(parts, { type: "application/octet-stream" });
}

/** Reverse of encryptFile. Throws if the key is wrong — GCM authenticates. */
export async function decryptToBlob(
  data: ArrayBuffer,
  key: CryptoKey,
  mimeType: string,
): Promise<Blob> {
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  const parts: BlobPart[] = [];
  let offset = 0;

  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, false);
    offset += 4;

    const iv = bytes.subarray(offset, offset + 12);
    offset += 12;

    const cipher = bytes.subarray(offset, offset + length);
    offset += length;

    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );

    parts.push(plain);
  }

  return new Blob(parts, { type: mimeType });
}

export { toBase64Url, fromBase64Url, CHUNK_SIZE, PBKDF2_ITERATIONS };
