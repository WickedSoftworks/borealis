import { decryptToBlob, importKey } from "@/lib/crypto/e2e";

/**
 * Fetch ciphertext, decrypt it in this browser, and hand the plaintext to the
 * user as a normal download.
 *
 * The whole file is held in memory to do it. That is inherent to decrypting
 * client-side without the Streams-backed File System Access API, and it is the
 * practical ceiling on zero-knowledge uploads — unencrypted transfers stream
 * and have no such limit.
 */
export async function downloadEncrypted(
  url: string,
  encodedKey: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      response.headers.get("X-Borealis-Reason") ??
        `The server refused the file (${response.status}).`,
    );
  }

  const key = await importKey(encodedKey);
  const blob = await decryptToBlob(await response.arrayBuffer(), key, mimeType);

  saveBlob(blob, filename);
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Revoked on the next tick: Safari cancels the download if the URL dies
  // before it has started reading.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
