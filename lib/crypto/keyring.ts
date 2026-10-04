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

/** False when the browser would not store it: private mode, a full quota. */
function write(ring: Keyring): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ring));
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep a file's key. False when this browser would not keep it — and then
 * the caller holds the only copy, and must say so while it still can.
 *
 * Read back rather than trusting the write: a failure here used to be
 * swallowed, and an encrypted upload reported success while its key was
 * already gone.
 */
export function rememberKey(fileId: string, encodedKey: string): boolean {
  return (
    write({ ...read(), [fileId]: encodedKey }) && read()[fileId] === encodedKey
  );
}

/** Whether keys made now would outlive the page. Checked before encrypting. */
export function keyringWritable(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const probe = `${STORAGE_KEY}.probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
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

const EXPORT_FORMAT = "borealis-keys";

/** How many keys this browser holds. */
export function keyCount(): number {
  return Object.keys(read()).length;
}

/**
 * The keyring, or the given keys, as a file to keep somewhere safer than one
 * browser's site data: a password manager, an encrypted disk. It is the
 * plaintext keys — anyone holding the file and the server's bytes can read
 * those files — and the interface says so where it offers it.
 */
export function exportKeys(only?: Record<string, string>): string {
  return `${JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      keys: only ?? read(),
    },
    null,
    2,
  )}\n`;
}

/**
 * Merge an exported keyring into this browser's. Returns how many keys it
 * added or confirmed, or null when the text is not an export. Keys already
 * here are kept: a file has one key, so a different one is a different file.
 */
export function importKeys(text: string): number | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { format?: unknown }).format !== EXPORT_FORMAT
  ) {
    return null;
  }

  const keys = (parsed as { keys?: unknown }).keys;
  if (!keys || typeof keys !== "object") return null;

  const ring = read();
  let count = 0;

  for (const [fileId, key] of Object.entries(keys)) {
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,}$/.test(key)) continue;
    ring[fileId] ??= key;
    count++;
  }

  return write(ring) ? count : null;
}
