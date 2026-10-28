import type { FolderViewNode } from "@/components/folder-tree";
import { GettingStarted } from "@/components/getting-started";
import { QuotaMeter } from "@/components/quota-meter";
import { SearchBox } from "@/components/search-box";
import { TrashTable } from "@/components/trash-table";
import { Uploader } from "@/components/uploader";
import { VaultBrowser } from "@/components/vault-browser";
import { db } from "@/lib/db";
import {
  FILES_PER_PAGE,
  fileOrderBy,
  parseFileSort,
  parsePage,
} from "@/lib/file-sort";
import {
  buildTree,
  type FolderRow,
  type FolderTreeNode,
  folderRows,
  pathTo,
  trashedFolderRoots,
} from "@/lib/folders";
import { formatBytes } from "@/lib/format";
import { canDeleteFile } from "@/lib/permissions";
import { previewable } from "@/lib/preview";
import { purgeDueAt } from "@/lib/purge";
import { accountUsage } from "@/lib/quota";
import { getSession } from "@/lib/session";
import { shareFormContext } from "@/lib/shares/allowlist";
import { trashedFiles } from "@/lib/trash";

export default async function DashboardPage({
  searchParams,
}: {
  // A Promise in Next 16 — see node_modules/next/dist/docs, page.md.
  searchParams: Promise<{
    folder?: string | string[];
    sort?: string | string[];
    page?: string | string[];
  }>;
}) {
  const session = await getSession();

  // The layout guarantees a session; this narrows the type.
  if (!session) return null;

  const query = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const folderParam = first(query.folder);
  const sort = parseFileSort(first(query.sort));

  // Every live folder this account owns. Folders are the small table — a vault
  // has thousands of files and a few dozen folders — so the whole tree costs
  // one query and the sidebar needs all of it anyway.
  const allFolders = await folderRows(session.user.id);
  const currentFolder =
    folderParam && allFolders.some((row) => row.id === folderParam)
      ? folderParam
      : null;

  const inFolder = {
    ownerId: session.user.id,
    deletedAt: null,
    folderId: currentFolder,
  };

  // Counted first so an out-of-range ?page= lands on the last real page
  // rather than on an empty one.
  const folderTotal = await db.file.count({ where: inFolder });
  const pageCount = Math.max(1, Math.ceil(folderTotal / FILES_PER_PAGE));
  const page = parsePage(first(query.page), pageCount);

  const [
    files,
    vault,
    fileCounts,
    trashed,
    trashedFolders,
    shareCount,
    usage,
    context,
  ] = await Promise.all([
    // One folder, one page. A vault of thousands of files used to be one
    // query and one DOM list of all of them.
    db.file.findMany({
      where: inFolder,
      orderBy: fileOrderBy(sort),
      skip: (page - 1) * FILES_PER_PAGE,
      take: FILES_PER_PAGE,
      select: {
        id: true,
        originalName: true,
        size: true,
        createdAt: true,
        mimeType: true,
        isEncrypted: true,
        thumbnailKey: true,
        scanStatus: true,
        text: { select: { status: true, error: true } },
      },
    }),
    // Vault-wide totals still have to count everything, but a sum in the
    // database beats loading every row to add them up here.
    db.file.aggregate({
      where: { ownerId: session.user.id, deletedAt: null },
      _sum: { size: true },
      _count: true,
    }),
    db.file.groupBy({
      by: ["folderId"],
      where: { ownerId: session.user.id, deletedAt: null },
      _count: true,
    }),
    // Deleted files keep their bytes for a retention window; until it closes
    // they are recoverable, so they get a panel rather than silently vanishing.
    trashedFiles(session.user.id),
    trashedFolderRoots(session.user.id),
    db.share.count({ where: { ownerId: session.user.id } }),
    accountUsage(session.user.id),
    shareFormContext(),
  ]);

  const filesPerFolder = new Map(
    fileCounts.flatMap((group) =>
      group.folderId ? [[group.folderId, group._count] as const] : [],
    ),
  );

  const subfolders = allFolders
    .filter((row) => row.parentId === currentFolder)
    .map((row) => ({
      id: row.id,
      name: row.name,
      fileCount: filesPerFolder.get(row.id) ?? 0,
      folderCount: allFolders.filter((child) => child.parentId === row.id)
        .length,
    }));

  // Built on the server so the client never receives Date objects it has no
  // use for, and so the breadcrumb and the tree agree by construction.
  const toView = (node: FolderTreeNode<FolderRow>): FolderViewNode => ({
    id: node.id,
    name: node.name,
    parentId: node.parentId,
    children: node.children.map(toView),
  });

  const crumbs = [
    { id: null, name: "Vault" },
    ...(currentFolder === null
      ? []
      : pathTo(allFolders, currentFolder).map((row) => ({
          id: row.id as string | null,
          name: row.name,
        }))),
  ];

  // A brand-new account: nothing stored, nothing sent, no folders. The empty
  // table alone does not say what this instance is for.
  const firstRun =
    vault._count === 0 &&
    shareCount === 0 &&
    allFolders.length === 0 &&
    trashed.length === 0 &&
    trashedFolders.length === 0;

  const storedBytes = Number(vault._sum.size ?? 0n);
  const fileCount = vault._count;

  return (
    <div className="flex flex-col gap-8">
      <div className="rise flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-serif text-4xl font-medium tracking-[-0.02em]">
            Files
          </h1>
          <p className="data text-fg-subtle">
            {fileCount} {fileCount === 1 ? "file" : "files"} ·{" "}
            {allFolders.length} {allFolders.length === 1 ? "folder" : "folders"}{" "}
            · {formatBytes(storedBytes)}
          </p>
        </div>

        {usage.limit !== null && (
          <div className="ml-auto w-full max-w-xs">
            <QuotaMeter
              used={Number(usage.used)}
              trash={Number(usage.trash)}
              limit={Number(usage.limit)}
            />
          </div>
        )}
      </div>

      {firstRun && <GettingStarted />}

      <section
        id="upload"
        aria-label="Upload"
        className="rise scroll-mt-6"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        <Uploader
          folderId={currentFolder}
          folderName={
            currentFolder === null
              ? null
              : (allFolders.find((row) => row.id === currentFolder)?.name ??
                null)
          }
        />
      </section>

      {/*
        Search sits above the list rather than beside it: it is the way into a
        vault too big to scroll, and it answers a different question than the
        list below does.
      */}
      <section
        aria-label="Search"
        className="rise"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        <SearchBox folders={buildTree(allFolders).map(toView)} />
      </section>

      <section
        aria-label="Your files"
        className="rise"
        style={{ "--i": 3 } as React.CSSProperties}
      >
        <VaultBrowser
          folders={buildTree(allFolders).map(toView)}
          crumbs={crumbs}
          currentFolderId={currentFolder}
          subfolders={subfolders}
          pagination={{ page, pageCount, total: folderTotal, sort }}
          context={context}
          files={files.map((file) => ({
            id: file.id,
            originalName: file.originalName,
            size: Number(file.size),
            createdAt: file.createdAt.toISOString(),
            mimeType: file.mimeType,
            isEncrypted: file.isEncrypted,
            hasThumbnail: file.thumbnailKey !== null,
            previewKind: previewable(file)?.kind ?? null,
            scanStatus: file.scanStatus,
            index: file.text,
            // Your own files, so always deletable — but computed by the same
            // function the endpoint uses rather than assumed.
            canDelete: canDeleteFile(session.user, {
              id: session.user.id,
              role: session.user.role,
            }),
          }))}
        />
      </section>

      {(trashed.length > 0 || trashedFolders.length > 0) && (
        <section aria-labelledby="trash-label" className="flex flex-col gap-4">
          <h2 id="trash-label" className="label-caps">
            Trash
          </h2>
          <TrashTable
            folders={trashedFolders.map((folder) => ({
              id: folder.id,
              name: folder.name,
              folders: folder.folders,
              files: folder.files,
              bytes: Number(folder.bytes),
              purgeAt: purgeDueAt(folder.deletedAt).toISOString(),
            }))}
            files={trashed.map((file) => ({
              id: file.id,
              originalName: file.originalName,
              size: Number(file.size),
              isEncrypted: file.isEncrypted,
              // The window is server configuration; the browser is told the
              // deadline, never asked to work it out.
              purgeAt: purgeDueAt(file.deletedAt ?? new Date()).toISOString(),
              inFolder: file.folder?.deletedAt ? file.folder.name : null,
            }))}
          />
        </section>
      )}
    </div>
  );
}
