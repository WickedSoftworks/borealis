import { db } from "@/lib/db";
import {
  buildTree,
  descendantsOf,
  type FolderRow,
  folderRows,
} from "@/lib/folders";

/**
 * What is actually inside a share.
 *
 * A share used to be a flat list of files, and two places assumed it: the
 * recipient page walked `share.items[].file`, and the download route proved
 * membership with a single `shareItem.findFirst`. Folder shares break both.
 *
 * They are answered here together, deliberately. One of them decides what a
 * recipient SEES and the other decides what may LEAVE the server; if they are
 * allowed to drift, the second one is a security hole with a UI that disagrees
 * with it. `shareContents` and `shareIncludesFile` therefore compute the same
 * scope through the same function.
 *
 * Folder shares are LIVE: the folder is resolved per request, so a file added
 * to a shared folder afterwards is part of the share from that moment. That is
 * the point of the feature and also its sharp edge — see `addedAfterShare`.
 */

/** Enough of a Share to resolve it. Callers always have this already. */
export type ShareRef = {
  id: string;
  ownerId: string;
  createdAt: Date;
};

export type ShareFile = {
  id: string;
  originalName: string;
  size: bigint;
  mimeType: string;
  isEncrypted: boolean;
  createdAt: Date;
  folderId: string | null;
  /**
   * Uploaded after this link was made, so it arrived through a shared folder
   * rather than being chosen by the sender.
   *
   * The recipient page needs this to tell "the sender added this later, and if
   * it is encrypted your link has no key for it" apart from "your link arrived
   * cut short" — which is what a missing key means in every other case, and the
   * only message that matters when a link really was truncated.
   */
  addedAfterShare: boolean;
};

export type ShareFolder = {
  id: string;
  name: string;
  files: ShareFile[];
  folders: ShareFolder[];
};

export type ShareContents = {
  /** Chosen file by file, so they belong to no folder in this listing. */
  files: ShareFile[];
  folders: ShareFolder[];
};

const FILE_SELECT = {
  id: true,
  originalName: true,
  size: true,
  mimeType: true,
  isEncrypted: true,
  createdAt: true,
  folderId: true,
} as const;

type Scope = {
  directFileIds: string[];
  /** Shared roots plus every live folder beneath them. */
  allowedFolderIds: string[];
  rootFolderIds: string[];
  rows: FolderRow[];
};

/**
 * The one place a share's reach is computed.
 *
 * A shared folder that has since been trashed contributes nothing: it is absent
 * from `folderRows`, so neither it nor its subtree reaches `allowedFolderIds`,
 * and its files stay unreachable until it is restored.
 */
async function resolveScope(share: ShareRef): Promise<Scope> {
  const items = await db.shareItem.findMany({
    where: { shareId: share.id },
    select: { fileId: true, folderId: true },
  });

  const directFileIds = items.flatMap((item) =>
    item.fileId ? [item.fileId] : [],
  );
  const claimedFolderIds = items.flatMap((item) =>
    item.folderId ? [item.folderId] : [],
  );

  if (claimedFolderIds.length === 0) {
    return { directFileIds, allowedFolderIds: [], rootFolderIds: [], rows: [] };
  }

  const rows = await folderRows(share.ownerId);
  const { rootFolderIds, allowedFolderIds } = expandSharedFolders(
    rows,
    claimedFolderIds,
  );

  return { directFileIds, allowedFolderIds, rootFolderIds, rows };
}

/**
 * Which folders a share actually reaches, given the owner's live folders.
 *
 * The security-critical arithmetic, kept pure and separate so it can be tested
 * without a database. `rows` is the owner's LIVE folders, so a shared folder
 * that has since been trashed is simply absent and contributes nothing —
 * neither itself nor its subtree — which is what keeps a trashed folder's files
 * unreachable through a link that still points at it.
 *
 * A folder belonging to someone else is absent for the same reason, so this
 * cannot be tricked into widening a share across accounts.
 */
export function expandSharedFolders(
  rows: FolderRow[],
  claimedFolderIds: string[],
): { rootFolderIds: string[]; allowedFolderIds: string[] } {
  const live = new Set(rows.map((row) => row.id));
  const rootFolderIds = claimedFolderIds.filter((id) => live.has(id));
  const allowed = new Set<string>();

  for (const rootId of rootFolderIds) {
    allowed.add(rootId);
    for (const node of descendantsOf(rows, rootId)) allowed.add(node.id);
  }

  return { rootFolderIds, allowedFolderIds: [...allowed] };
}

/**
 * Prisma's `in: []` matches nothing, so an empty scope stays empty rather than
 * collapsing into "every file". Worth stating: the failure mode of getting this
 * wrong is every file on the instance behind one token.
 */
function scopeFilter(scope: Scope, ownerId: string) {
  return {
    // Scoped to the share's owner even though the ids came from ShareItem.
    // Defence in depth against a stale row pointing somewhere it should not.
    ownerId,
    deletedAt: null,
    OR: [
      { id: { in: scope.directFileIds } },
      { folderId: { in: scope.allowedFolderIds } },
    ],
  };
}

/** The nested structure the recipient page renders. */
export async function shareContents(share: ShareRef): Promise<ShareContents> {
  const scope = await resolveScope(share);

  if (scope.directFileIds.length === 0 && scope.allowedFolderIds.length === 0) {
    return { files: [], folders: [] };
  }

  const files = await db.file.findMany({
    where: scopeFilter(scope, share.ownerId),
    orderBy: { originalName: "asc" },
    select: FILE_SELECT,
  });

  const direct = new Set(scope.directFileIds);
  const allowed = new Set(scope.allowedFolderIds);

  const decorate = (file: (typeof files)[number]): ShareFile => ({
    ...file,
    addedAfterShare: isAddedAfterShare(file, share.createdAt, direct),
  });

  const byFolder = new Map<string, ShareFile[]>();
  const loose: ShareFile[] = [];

  for (const file of files) {
    // A file chosen by name stays at the top level even when it also happens to
    // live inside a shared folder — the sender picked it, so it is not a
    // surprise arrival and should not be buried in the tree.
    if (
      file.folderId === null ||
      !allowed.has(file.folderId) ||
      direct.has(file.id)
    ) {
      loose.push(decorate(file));
      continue;
    }

    const list = byFolder.get(file.folderId);
    if (list) list.push(decorate(file));
    else byFolder.set(file.folderId, [decorate(file)]);
  }

  // Only the shared subtrees, so a sibling folder never appears in the listing.
  const shape = buildTree(scope.rows.filter((row) => allowed.has(row.id)));

  const toShareFolder = (node: (typeof shape)[number]): ShareFolder => ({
    id: node.id,
    name: node.name,
    files: byFolder.get(node.id) ?? [],
    folders: node.children.map(toShareFolder),
  });

  return {
    files: loose,
    folders: shape
      .filter((node) => scope.rootFolderIds.includes(node.id))
      .map(toShareFolder),
  };
}

/**
 * The download gate: the file this token may serve, or null.
 *
 * Replaces the flat `shareItem.findFirst` membership check. Returns the row
 * rather than a boolean so the caller does not re-fetch what this already read.
 */
export async function shareIncludesFile(share: ShareRef, fileId: string) {
  const scope = await resolveScope(share);

  if (scope.directFileIds.length === 0 && scope.allowedFolderIds.length === 0) {
    return null;
  }

  return db.file.findFirst({
    where: { id: fileId, ...scopeFilter(scope, share.ownerId) },
    select: { ...FILE_SELECT, storageKey: true },
  });
}

/**
 * Whether a file arrived in the share by itself rather than being chosen.
 *
 * Age alone is not the answer. A file the sender named is a deliberate choice
 * however recently it was uploaded — and once a share can be edited, naming one
 * after the fact is an ordinary thing to do. Only a file that came in through a
 * shared folder is a surprise, which is exactly what the recipient page needs
 * to distinguish from a link that arrived cut short.
 */
export function isAddedAfterShare(
  file: { id: string; createdAt: Date },
  shareCreatedAt: Date,
  directFileIds: ReadonlySet<string>,
): boolean {
  if (directFileIds.has(file.id)) return false;

  return file.createdAt > shareCreatedAt;
}

/** Every file in a share, folders flattened away. Totals and counts want this. */
export function flattenShareContents(contents: ShareContents): ShareFile[] {
  const out: ShareFile[] = [...contents.files];

  const walk = (folders: ShareFolder[]) => {
    for (const folder of folders) {
      out.push(...folder.files);
      walk(folder.folders);
    }
  };

  walk(contents.folders);

  return out;
}
