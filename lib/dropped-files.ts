/**
 * Files from a drop or a folder picker, with the path each one had.
 *
 * A dropped folder arrives as a directory entry, not as its files, and
 * `dataTransfer.files` lists it as one useless zero-byte item. Walking the
 * entries recovers every file and its place in the tree, so a dropped
 * `Photos/2024/raw` lands as that tree rather than as a flat pile — or, worse,
 * as nothing at all.
 */

export type PickedFile = {
  file: File;
  /** Folder segments above the file, e.g. ["Photos", "2024"]. Empty at top level. */
  folders: string[];
};

type Entry = FileSystemEntry & {
  isFile: boolean;
  isDirectory: boolean;
};

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** readEntries returns at most ~100 at a time; call until it returns none. */
async function readAll(reader: FileSystemDirectoryReader): Promise<Entry[]> {
  const all: Entry[] = [];

  for (;;) {
    const batch = await new Promise<Entry[]>((resolve, reject) =>
      reader.readEntries((entries) => resolve(entries as Entry[]), reject),
    );
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function walk(entry: Entry, folders: string[], out: PickedFile[]) {
  if (entry.isFile) {
    out.push({
      file: await readFile(entry as unknown as FileSystemFileEntry),
      folders,
    });
    return;
  }

  if (entry.isDirectory) {
    const reader = (
      entry as unknown as FileSystemDirectoryEntry
    ).createReader();
    for (const child of await readAll(reader)) {
      await walk(child, [...folders, entry.name], out);
    }
  }
}

export async function filesFromDrop(
  transfer: DataTransfer,
): Promise<PickedFile[]> {
  const entries = Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.() as Entry | null)
    .filter((entry): entry is Entry => entry !== null && entry !== undefined);

  // No entry API (or nothing that is a directory): the flat list is right.
  if (entries.length === 0 || !entries.some((entry) => entry.isDirectory)) {
    return Array.from(transfer.files).map((file) => ({ file, folders: [] }));
  }

  const out: PickedFile[] = [];
  for (const entry of entries) await walk(entry, [], out);
  return out;
}

/** From `<input webkitdirectory>`: each file knows its path already. */
export function filesFromInput(list: FileList | null): PickedFile[] {
  return Array.from(list ?? []).map((file) => {
    const segments = (file.webkitRelativePath || file.name).split("/");
    return { file, folders: segments.slice(0, -1) };
  });
}
