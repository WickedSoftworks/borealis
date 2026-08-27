import { db } from "@/lib/db";

/**
 * The folder tree.
 *
 * Split the way lib/purge.ts was split from lib/trash.ts: everything above the
 * "Database" heading is pure arithmetic over a plain array of rows, unit-tested
 * without a database. Only the thin wrappers below it touch Prisma.
 *
 * Two invariants live here because nothing in the schema enforces them. `Folder`
 * is a self-referencing tree with no constraint preventing a cycle, and a cycle
 * inside a recursive walk is an infinite loop in a request handler. Every
 * traversal therefore carries a visited set AND a depth cap; either alone is
 * enough to terminate, and both are cheap.
 */

/** Enough of a Folder row for any of the pure functions. */
export type FolderNode = {
  id: string;
  name: string;
  parentId: string | null;
};

export type FolderTreeNode<T extends FolderNode = FolderNode> = T & {
  children: FolderTreeNode<T>[];
};

/**
 * Deep enough that no human filing system reaches it, shallow enough that a
 * recursive render and an O(depth) query plan both stay sane.
 */
export const MAX_FOLDER_DEPTH = 32;

function byId<T extends FolderNode>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

/** Children indexed by parent id. Shared by every downward walk. */
function childIndex<T extends FolderNode>(rows: T[]): Map<string, T[]> {
  const children = new Map<string, T[]>();

  for (const row of rows) {
    if (row.parentId === null) continue;

    const list = children.get(row.parentId);
    if (list) list.push(row);
    else children.set(row.parentId, [row]);
  }

  return children;
}

/**
 * Adjacency list to nested nodes, children sorted by name.
 *
 * A row whose parent is not present in `rows` becomes a root rather than
 * disappearing. That is not a defensive nicety: callers routinely pass a
 * filtered set (live folders only, while the parent sits in the trash), and
 * silently dropping the whole subtree would hide files the owner still has.
 */
export function buildTree<T extends FolderNode>(
  rows: T[],
): FolderTreeNode<T>[] {
  const index = byId(rows);
  const children = childIndex(rows);
  const nodes = new Map<string, FolderTreeNode<T>>(
    rows.map((row) => [row.id, { ...row, children: [] }]),
  );

  const roots: FolderTreeNode<T>[] = [];
  const placed = new Set<string>();

  /** Attach descendants breadth-first, never placing a node twice. */
  const attachFrom = (rootIds: string[]) => {
    let frontier = rootIds;
    let depth = 0;

    while (frontier.length > 0 && depth < MAX_FOLDER_DEPTH) {
      const next: string[] = [];

      for (const id of frontier) {
        const parent = nodes.get(id);
        if (!parent) continue;

        for (const child of children.get(id) ?? []) {
          const node = nodes.get(child.id);
          if (!node || placed.has(child.id)) continue;

          placed.add(child.id);
          parent.children.push(node);
          next.push(child.id);
        }
      }

      frontier = next;
      depth++;
    }
  };

  // A row is a root when it has no parent, names itself, or names a parent that
  // is not in this set — the last case being a live child of a trashed parent,
  // which must surface rather than take its files down with it.
  const rootIds: string[] = [];

  for (const row of rows) {
    const hasUsableParent =
      row.parentId !== null &&
      row.parentId !== row.id &&
      index.has(row.parentId);

    if (hasUsableParent) continue;

    const node = nodes.get(row.id);
    if (!node) continue;

    placed.add(row.id);
    roots.push(node);
    rootIds.push(row.id);
  }

  attachFrom(rootIds);

  // Anything still unplaced sits in a cycle that no root leads into — every
  // member has a parent, so none qualified above. Left alone the whole ring
  // would vanish from the dashboard while its files still existed. Promote the
  // first member and descend from it, until nothing is stranded.
  for (const row of rows) {
    if (placed.has(row.id)) continue;

    const node = nodes.get(row.id);
    if (!node) continue;

    placed.add(row.id);
    roots.push(node);
    attachFrom([row.id]);
  }

  const sort = (list: FolderTreeNode<T>[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of list) sort(child.children);
  };

  sort(roots);

  return roots;
}

/**
 * Root-first ancestry of `id`, inclusive. The breadcrumb.
 *
 * Returns an empty array for an unknown id. A cycle terminates at the visited
 * set and yields the partial path rather than throwing — a breadcrumb is a
 * navigation aid, and refusing to render the dashboard because of a malformed
 * tree serves nobody.
 */
export function pathTo<T extends FolderNode>(rows: T[], id: string): T[] {
  const index = byId(rows);
  const seen = new Set<string>();
  const path: T[] = [];

  let current = index.get(id);

  while (current && !seen.has(current.id) && path.length < MAX_FOLDER_DEPTH) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }

  return path.reverse();
}

/**
 * Walk down from `id` one level at a time, calling `onLevel` with each.
 *
 * The one downward traversal, so the visited set and the depth cap are written
 * once. `id` starts in the visited set: a folder that is its own ancestor must
 * not be reported as its own descendant.
 */
function walkDown<T extends FolderNode>(
  rows: T[],
  id: string,
  onLevel: (level: T[]) => void,
): number {
  const children = childIndex(rows);
  const seen = new Set<string>([id]);

  let frontier = children.get(id) ?? [];
  let levels = 0;

  while (frontier.length > 0 && levels < MAX_FOLDER_DEPTH) {
    const fresh: T[] = [];
    const next: T[] = [];

    for (const node of frontier) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      fresh.push(node);
      next.push(...(children.get(node.id) ?? []));
    }

    // Every node at this level was already visited: a cycle closed back on
    // itself, and there is no new level to count.
    if (fresh.length === 0) break;

    onLevel(fresh);
    frontier = next;
    levels++;
  }

  return levels;
}

/** Every folder beneath `id`, excluding `id` itself. Breadth-first. */
export function descendantsOf<T extends FolderNode>(
  rows: T[],
  id: string,
): T[] {
  const out: T[] = [];

  walkDown(rows, id, (level) => out.push(...level));

  return out;
}

/** How deep `id` sits. A root folder is depth 1. Unknown ids are 0. */
export function depthOf<T extends FolderNode>(rows: T[], id: string): number {
  return pathTo(rows, id).length;
}

/** How tall the subtree under `id` is. A folder with no children is 1. */
export function heightOf<T extends FolderNode>(rows: T[], id: string): number {
  if (!byId(rows).has(id)) return 0;

  return 1 + walkDown(rows, id, () => {});
}

/**
 * Whether reparenting `movedId` under `newParentId` would produce a cycle or
 * bust the depth cap.
 *
 * Moving a folder into itself or into one of its own descendants detaches the
 * whole subtree from the root: it still exists, still belongs to the owner, and
 * is unreachable from every UI. Refusing is the only sane answer.
 */
export function wouldCycle<T extends FolderNode>(
  rows: T[],
  movedId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === movedId) return true;

  const index = byId(rows);
  if (!index.has(newParentId)) return false;

  if (descendantsOf(rows, movedId).some((node) => node.id === newParentId)) {
    return true;
  }

  return (
    depthOf(rows, newParentId) + heightOf(rows, movedId) > MAX_FOLDER_DEPTH
  );
}

// ---------------------------------------------------------------- Database --

const FOLDER_SELECT = {
  id: true,
  name: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type FolderRow = FolderNode & {
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Every folder an account owns.
 *
 * Folders are loaded whole rather than one level at a time. A vault has
 * thousands of files and a few dozen folders; the tree is the small table, and
 * one query beats a query per expanded node.
 */
export async function folderRows(
  ownerId: string,
  { trashed = false }: { trashed?: boolean } = {},
): Promise<FolderRow[]> {
  return db.folder.findMany({
    where: { ownerId, deletedAt: trashed ? { not: null } : null },
    orderBy: { name: "asc" },
    select: FOLDER_SELECT,
  });
}

export async function folderTree(ownerId: string) {
  return buildTree(await folderRows(ownerId));
}

/**
 * Resolve a folder id the caller claims to own, or null.
 *
 * The IDOR gate for roadmap item 20. `lib/tus.ts` takes `folderId` from
 * client-supplied upload metadata; without this, a user can file uploads into
 * another account's folder. Returns null for unknown, trashed, and
 * someone-else's alike, so the caller cannot tell them apart.
 */
export async function assertOwnedFolder(
  folderId: string | null | undefined,
  ownerId: string,
): Promise<string | null> {
  if (!folderId) return null;

  const folder = await db.folder.findFirst({
    where: { id: folderId, ownerId, deletedAt: null },
    select: { id: true },
  });

  return folder?.id ?? null;
}

/** A folder plus every live folder beneath it. */
async function subtreeIds(folderId: string, ownerId: string, trashed = false) {
  const rows = await folderRows(ownerId, { trashed });

  if (!rows.some((row) => row.id === folderId)) return null;

  return [folderId, ...descendantsOf(rows, folderId).map((row) => row.id)];
}

/**
 * Trash a folder and everything under it, as one act.
 *
 * Every row in the subtree gets the SAME `deletedAt`, which is what makes
 * restoring precise: a file trashed on its own last week carries a different
 * timestamp and stays in the trash when this folder comes back. Without that,
 * restoring a folder would silently resurrect unrelated deletions.
 *
 * Shares are revoked exactly as `revokeSharesCarrying` does for a single file,
 * and for the same reason — a link into the trash would either serve a 404 or
 * spring back to life on restore. Folder shares are revoked too: a live folder
 * share whose folder is trashed resolves to an empty listing, which is a worse
 * answer to give a recipient than a closed link.
 */
export async function trashFolderTree(folderId: string, ownerId: string) {
  const ids = await subtreeIds(folderId, ownerId);

  if (ids === null) return null;

  const deletedAt = new Date();

  return db.$transaction(async (tx) => {
    const fileIds = (
      await tx.file.findMany({
        where: { ownerId, folderId: { in: ids }, deletedAt: null },
        select: { id: true },
      })
    ).map((file) => file.id);

    const shareIds = (
      await tx.shareItem.findMany({
        where: {
          OR: [{ folderId: { in: ids } }, { fileId: { in: fileIds } }],
        },
        select: { shareId: true },
      })
    ).map((item) => item.shareId);

    const revoked =
      shareIds.length === 0
        ? { count: 0 }
        : await tx.share.updateMany({
            where: { id: { in: shareIds }, revokedAt: null },
            data: { revokedAt: new Date() },
          });

    const files = await tx.file.updateMany({
      where: { id: { in: fileIds } },
      data: { deletedAt },
    });

    const folders = await tx.folder.updateMany({
      where: { id: { in: ids }, ownerId, deletedAt: null },
      data: { deletedAt },
    });

    return {
      folders: folders.count,
      files: files.count,
      revokedShares: revoked.count,
      deletedAt,
    };
  });
}

/**
 * Undo one folder trashing.
 *
 * Restores only the rows that went down with this folder, matched on the shared
 * `deletedAt`. Links stay revoked — getting the files back is not the same as
 * re-opening the links you had already handed out.
 *
 * A folder whose parent is still in the trash comes back as a root of the
 * dashboard tree rather than vanishing; `buildTree` treats an absent parent as
 * a root precisely so this case stays visible.
 */
export async function restoreFolderTree(folderId: string, ownerId: string) {
  const folder = await db.folder.findFirst({
    where: { id: folderId, ownerId, deletedAt: { not: null } },
    select: { id: true, name: true, deletedAt: true },
  });

  if (!folder?.deletedAt) return null;

  const ids = await subtreeIds(folderId, ownerId, true);

  if (ids === null) return null;

  const deletedAt = folder.deletedAt;

  return db.$transaction(async (tx) => {
    const files = await tx.file.updateMany({
      where: { ownerId, folderId: { in: ids }, deletedAt },
      data: { deletedAt: null },
    });

    const folders = await tx.folder.updateMany({
      where: { id: { in: ids }, ownerId, deletedAt },
      data: { deletedAt: null },
    });

    return { name: folder.name, folders: folders.count, files: files.count };
  });
}

/**
 * How many live links already reach into this folder.
 *
 * Folder shares are live, so moving a file into a shared folder publishes it
 * immediately. That is the feature working as designed and also the easiest way
 * to leak something by accident, so the move endpoint reports this back and the
 * interface says so rather than letting it happen quietly.
 *
 * Counts ancestors as well as the folder itself: a share on /Projects reaches
 * /Projects/2024/raw just as surely.
 */
export async function sharesCoveringFolder(
  folderId: string,
  ownerId: string,
): Promise<number> {
  const rows = await folderRows(ownerId);
  const ancestry = pathTo(rows, folderId).map((row) => row.id);

  if (ancestry.length === 0) return 0;

  const now = new Date();

  const items = await db.shareItem.findMany({
    where: {
      folderId: { in: ancestry },
      share: {
        ownerId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    },
    select: { shareId: true },
  });

  return new Set(items.map((item) => item.shareId)).size;
}

/**
 * Whether `name` is already taken among `parentId`'s children.
 *
 * Compared in JavaScript rather than with Prisma's `mode: "insensitive"`, which
 * is a PostgreSQL-only feature — using it would make this check silently
 * case-sensitive on SQLite, and this schema must behave identically on both.
 */
export async function siblingNameTaken(
  ownerId: string,
  parentId: string | null,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const siblings = await db.folder.findMany({
    where: { ownerId, parentId, deletedAt: null },
    select: { id: true, name: true },
  });

  const wanted = name.trim().toLocaleLowerCase();

  return siblings.some(
    (sibling) =>
      sibling.id !== exceptId &&
      sibling.name.trim().toLocaleLowerCase() === wanted,
  );
}
