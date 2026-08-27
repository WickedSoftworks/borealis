import { AccessLog } from "@/components/access-log";
import type { FolderViewNode } from "@/components/folder-tree";
import { InvitePanel } from "@/components/invite-panel";
import { ReverseDialog } from "@/components/reverse-dialog";
import { SearchBox } from "@/components/search-box";
import { ShareTable } from "@/components/share-table";
import { TrashTable } from "@/components/trash-table";
import { Uploader } from "@/components/uploader";
import { VaultBrowser } from "@/components/vault-browser";
import { DataRow, Panel } from "@/components/world/panel";
import { db } from "@/lib/db";
import {
  buildTree,
  type FolderRow,
  type FolderTreeNode,
  folderRows,
  pathTo,
} from "@/lib/folders";
import { formatBytes } from "@/lib/format";
import { isAdmin, isRoot } from "@/lib/invites";
import { canDeleteFile } from "@/lib/permissions";
import { purgeDueAt } from "@/lib/purge";
import { getSession } from "@/lib/session";
import { trashedFiles } from "@/lib/trash";

export default async function DashboardPage({
  searchParams,
}: {
  // A Promise in Next 16 — see node_modules/next/dist/docs, page.md.
  searchParams: Promise<{ folder?: string | string[] }>;
}) {
  const session = await getSession();

  // The layout guarantees a session; this narrows the type.
  if (!session) return null;

  const requested = (await searchParams).folder;
  const folderParam = Array.isArray(requested) ? requested[0] : requested;

  // Every live folder this account owns. Folders are the small table — a vault
  // has thousands of files and a few dozen folders — so the whole tree costs
  // one query and the sidebar needs all of it anyway.
  const allFolders = await folderRows(session.user.id);
  const currentFolder =
    folderParam && allFolders.some((row) => row.id === folderParam)
      ? folderParam
      : null;

  const [files, vault, fileCounts, trashed, shares, accesses, invites] =
    await Promise.all([
      // Scoped to the folder being viewed rather than the whole vault, which
      // also stops the dashboard loading every file on every render.
      db.file.findMany({
        where: {
          ownerId: session.user.id,
          deletedAt: null,
          folderId: currentFolder,
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          originalName: true,
          size: true,
          createdAt: true,
          mimeType: true,
          isEncrypted: true,
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
      db.share.findMany({
        where: { ownerId: session.user.id, revokedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { items: true } },
          // Only the encrypted ones matter here: the dashboard has to rebuild
          // each link's key fragment from the browser's keyring when copying.
          items: {
            where: { file: { isEncrypted: true } },
            select: { fileId: true },
          },
        },
      }),
      db.shareAccess.findMany({
        where: { share: { ownerId: session.user.id } },
        orderBy: { createdAt: "desc" },
        take: 12,
        include: {
          share: { select: { name: true, token: true } },
          file: { select: { originalName: true } },
        },
      }),
      // Only queried for admins; a plain user never sees the invitation panel.
      isAdmin(session.user.role)
        ? db.invite.findMany({
            orderBy: { createdAt: "desc" },
            take: 20,
            include: { redeemedBy: { select: { email: true } } },
          })
        : Promise.resolve([]),
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

  const rows = shares.map((share) => ({
    id: share.id,
    token: share.token,
    kind: share.type === "REVERSE" ? ("REVERSE" as const) : ("SEND" as const),
    name: share.name,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    maxDownloads: share.maxDownloads,
    downloadCount: share.downloadCount,
    egressLimitBytes:
      share.egressLimitBytes === null ? null : Number(share.egressLimitBytes),
    egressUsedBytes: Number(share.egressUsedBytes),
    hasPassword: share.passwordHash !== null,
    viewOnly: share.viewOnly,
    fileCount: share._count.items,
    maxUploadFiles: share.maxUploadFiles,
    // fileId is nullable — a deleted file leaves its item behind.
    encryptedFileIds: share.items.flatMap((item) =>
      item.fileId ? [item.fileId] : [],
    ),
  }));

  const sendLinks = rows.filter((row) => row.kind === "SEND");
  const collectLinks = rows.filter((row) => row.kind === "REVERSE");

  const storedBytes = Number(vault._sum.size ?? 0n);
  const servedBytes = shares.reduce(
    (total, share) => total + Number(share.egressUsedBytes),
    0,
  );
  const downloads = shares.reduce(
    (total, share) => total + share.downloadCount,
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Panel title="Store" bodyClassName="p-0">
          <div className="p-3">
            <Uploader />
          </div>
        </Panel>

        <Panel title="Vault">
          <DataRow label="Files">{vault._count}</DataRow>
          <DataRow label="Stored">{formatBytes(storedBytes)}</DataRow>
          <DataRow label="Links out">{sendLinks.length}</DataRow>
          <DataRow label="Collecting">{collectLinks.length}</DataRow>
          <DataRow label="Downloads">{downloads}</DataRow>
          <DataRow label="Served">{formatBytes(servedBytes)}</DataRow>
        </Panel>
      </div>

      {/*
        Search sits above the grid rather than beside it: it is the way into a
        vault too big to scroll, and it answers a different question than the
        list below does.
      */}
      <Panel title="Find" bodyClassName="p-3">
        <SearchBox />
      </Panel>

      <Panel title="Files" bodyClassName="p-3">
        <VaultBrowser
          folders={buildTree(allFolders).map(toView)}
          crumbs={crumbs}
          currentFolderId={currentFolder}
          subfolders={subfolders}
          files={files.map((file) => ({
            id: file.id,
            originalName: file.originalName,
            size: Number(file.size),
            createdAt: file.createdAt.toISOString(),
            mimeType: file.mimeType,
            isEncrypted: file.isEncrypted,
            // Your own files, so always deletable — but computed by the same
            // function the endpoint uses rather than assumed.
            canDelete: canDeleteFile(session.user, {
              id: session.user.id,
              role: session.user.role,
            }),
          }))}
        />
      </Panel>

      {trashed.length > 0 && (
        <Panel title="Trash" bodyClassName="p-3">
          <TrashTable
            files={trashed.map((file) => ({
              id: file.id,
              originalName: file.originalName,
              size: Number(file.size),
              isEncrypted: file.isEncrypted,
              // The window is server configuration; the browser is told the
              // deadline, never asked to work it out.
              purgeAt: purgeDueAt(file.deletedAt ?? new Date()).toISOString(),
            }))}
          />
        </Panel>
      )}

      <Panel title="Live links">
        <ShareTable shares={sendLinks} />
      </Panel>

      {/*
        Collection links get their own panel rather than a row type in the one
        above: they point the opposite way — a stranger writing to this disk —
        and that is not a distinction to bury in a badge.
      */}
      <Panel title="Collection links" actions={<ReverseDialog />}>
        <ShareTable
          shares={collectLinks}
          emptyMessage="No collection links. Make one to let someone send you files without an account."
        />
      </Panel>

      {isAdmin(session.user.role) && (
        <Panel title="Invitations">
          <InvitePanel
            canMintAdmin={isRoot(session.user.role)}
            invites={invites.map((invite) => ({
              id: invite.id,
              grantsRole: invite.grantsRole,
              note: invite.note,
              expiresAt: invite.expiresAt?.toISOString() ?? null,
              revokedAt: invite.revokedAt?.toISOString() ?? null,
              redeemedAt: invite.redeemedAt?.toISOString() ?? null,
              createdAt: invite.createdAt.toISOString(),
              redeemedByEmail: invite.redeemedBy?.email ?? null,
            }))}
          />
        </Panel>
      )}

      <Panel title="Access log">
        <AccessLog
          entries={accesses.map((entry) => ({
            id: entry.id,
            action: entry.action,
            ipAddress: entry.ipAddress,
            bytesServed: Number(entry.bytesServed),
            createdAt: entry.createdAt.toISOString(),
            shareName: entry.share.name,
            shareToken: entry.share.token,
            fileName: entry.file?.originalName ?? null,
          }))}
        />
      </Panel>
    </div>
  );
}
