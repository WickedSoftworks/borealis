import { AccessLog } from "@/components/access-log";
import { FileTable } from "@/components/file-table";
import { InvitePanel } from "@/components/invite-panel";
import { ReverseDialog } from "@/components/reverse-dialog";
import { SearchBox } from "@/components/search-box";
import { ShareTable } from "@/components/share-table";
import { Uploader } from "@/components/uploader";
import { DataRow, Panel } from "@/components/world/panel";
import { db } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import { isAdmin, isRoot } from "@/lib/invites";
import { canDeleteFile } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export default async function DashboardPage() {
  const session = await getSession();

  // The layout guarantees a session; this narrows the type.
  if (!session) return null;

  const [files, shares, accesses, invites] = await Promise.all([
    db.file.findMany({
      where: { ownerId: session.user.id, deletedAt: null },
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

  const storedBytes = files.reduce(
    (total, file) => total + Number(file.size),
    0,
  );
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
          <DataRow label="Files">{files.length}</DataRow>
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
        <FileTable
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
