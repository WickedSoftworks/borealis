/**
 * The browser's local key store.
 *
 * A zero-knowledge file is encrypted before upload, so the key exists in
 * exactly one place: the browser that made it. The server cannot hold it
 * without defeating the point. This keeps it in localStorage against the file
 * id, so the operator can share or re-download the file later without being
 * asked to paste a key back in.
 *
 * The consequence is honest and has to be stated in the interface: clearing
 * this browser's storage destroys the only copy of the key, and the bytes on
 * the server become unrecoverable by anyone, operator included.
 */

const STORAGE_KEY = "borealis.keys.v1";

type Keyring = Record<string, string>;

function read(): Keyring {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};

    return parsed !== null && typeof parsed === "object"
      ? (parsed as Keyring)
      : {};
  } catch {
    // Storage disabled, or a corrupt entry. An empty ring degrades to "this
    // browser has no keys", which the interface already handles.
    return {};
  }
}

function write(ring: Keyring): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ring));
  } catch {
    // Private mode or a full quota. Nothing to do but let the caller's key
    // live only for this page — it still shows in the link it just made.
  }
}

export function rememberKey(fileId: string, encodedKey: string): void {
  write({ ...read(), [fileId]: encodedKey });
}

export function recallKey(fileId: string): string | null {
  return read()[fileId] ?? null;
}

export function forgetKey(fileId: string): void {
  const ring = read();
  delete ring[fileId];
  write(ring);
}

/** Which of these files this browser can actually decrypt. */
export function partitionByKey(fileIds: string[]): {
  known: Array<{ fileId: string; key: string }>;
  missing: string[];
} {
  const ring = read();
  const known: Array<{ fileId: string; key: string }> = [];
  const missing: string[] = [];

  for (const fileId of fileIds) {
    const key = ring[fileId];
    if (key) known.push({ fileId, key });
    else missing.push(fileId);
  }

  return { known, missing };
}
