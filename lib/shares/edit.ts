/**
 * The arithmetic of editing a share.
 *
 * No database, no clock, no crypto — so the two things an edit can get wrong
 * are testable on their own, and so the dialog can import `capWarnings` and warn
 * with the same rule the guard enforces. A warning computed a second way would
 * eventually disagree with `lib/shares/guard.ts`, and the whole point of the
 * caps is that the operator can trust what the interface says about them.
 */

export type ShareItemSet = { fileIds: string[]; folderIds: string[] };

/** Absent means "leave that kind alone"; present is a full replacement of it. */
export type ShareItemPatch = { fileIds?: string[]; folderIds?: string[] };

export type ShareItemDiff = {
  addFileIds: string[];
  removeFileIds: string[];
  addFolderIds: string[];
  removeFolderIds: string[];
  /** What the share carries once this diff is applied. */
  resulting: ShareItemSet;
  changed: boolean;
};

/** Deduped, order preserved, so the diff is stable and `createMany` cannot collide. */
function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function diffOne(current: string[], next: string[] | undefined) {
  if (next === undefined) {
    return { add: [], remove: [], resulting: current };
  }

  const resulting = unique(next);
  const before = new Set(current);
  const after = new Set(resulting);

  return {
    add: resulting.filter((id) => !before.has(id)),
    remove: current.filter((id) => !after.has(id)),
    resulting,
  };
}

export function diffShareItems(
  current: ShareItemSet,
  next: ShareItemPatch,
): ShareItemDiff {
  const files = diffOne(current.fileIds, next.fileIds);
  const folders = diffOne(current.folderIds, next.folderIds);

  return {
    addFileIds: files.add,
    removeFileIds: files.remove,
    addFolderIds: folders.add,
    removeFolderIds: folders.remove,
    resulting: { fileIds: files.resulting, folderIds: folders.resulting },
    // Reordering the same ids is not an edit, so compare membership rather than
    // whether a list was sent.
    changed:
      files.add.length > 0 ||
      files.remove.length > 0 ||
      folders.add.length > 0 ||
      folders.remove.length > 0,
  };
}

/** Bytes as `number`, not `bigint`: this crosses to the client, where egress already is one. */
export type ShareUsage = { downloadCount: number; egressUsedBytes: number };

export type CapPatch = {
  maxDownloads?: number | null;
  egressLimitBytes?: number | null;
};

export type CapWarning = {
  cap: "downloads" | "egress";
  used: number;
  limit: number;
};

/**
 * Which of the proposed caps would close the link the moment they are saved.
 *
 * Mirrors `guardShare`: downloads are refused at `downloadCount >= maxDownloads`,
 * and egress at `egressUsedBytes + bytes > egressLimitBytes`, which for any real
 * download means `used >= limit`. Lowering a cap under current usage is a
 * legitimate thing to want — it is how you stop a link you have had second
 * thoughts about — so this warns rather than refuses.
 */
export function capWarnings(usage: ShareUsage, next: CapPatch): CapWarning[] {
  const warnings: CapWarning[] = [];

  if (
    next.maxDownloads !== undefined &&
    next.maxDownloads !== null &&
    usage.downloadCount >= next.maxDownloads
  ) {
    warnings.push({
      cap: "downloads",
      used: usage.downloadCount,
      limit: next.maxDownloads,
    });
  }

  if (
    next.egressLimitBytes !== undefined &&
    next.egressLimitBytes !== null &&
    usage.egressUsedBytes >= next.egressLimitBytes
  ) {
    warnings.push({
      cap: "egress",
      used: usage.egressUsedBytes,
      limit: next.egressLimitBytes,
    });
  }

  return warnings;
}
