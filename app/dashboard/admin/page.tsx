import { notFound } from "next/navigation";
import { AuditLog } from "@/components/admin/audit-log";
import { JobsPanel } from "@/components/admin/jobs-panel";
import { SettingsPanel } from "@/components/admin/settings-panel";
import { StoragePanel } from "@/components/admin/storage-panel";
import { AdminFiles } from "@/components/admin-files";
import { AdminUsers } from "@/components/admin-users";
import { Panel } from "@/components/world/panel";
import { db } from "@/lib/db";
import { isAdmin, isRoot } from "@/lib/invites";
import { jobCounts } from "@/lib/jobs";
import { canDeleteFile, deletableFileWhere } from "@/lib/permissions";
import { lastReconcileReport } from "@/lib/reconcile";
import { getSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { settingsSnapshot } from "@/lib/settings-snapshot";

export const metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const session = await getSession();

  // 404 rather than 403: an ordinary user should not learn this route exists.
  if (!session || !isAdmin(session.user.role)) notFound();

  const actor = { id: session.user.id, role: session.user.role };

  const [
    users,
    files,
    storedByUser,
    trash,
    settings,
    snapshot,
    counts,
    failed,
    report,
    audit,
  ] = await Promise.all([
    db.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        banned: true,
        emailVerified: true,
        twoFactorEnabled: true,
        storageQuotaBytes: true,
        createdAt: true,
        _count: { select: { files: true, shares: true } },
      },
    }),
    // Every file this actor is permitted to act on, and no others — the same
    // rule the delete endpoint enforces, expressed as a query.
    db.file.findMany({
      where: { ...deletableFileWhere(actor), deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        owner: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
    // Trash included: that is what occupies the disk, and it is what a quota
    // counts.
    db.file.groupBy({
      by: ["ownerId"],
      _sum: { size: true },
      _count: { _all: true },
    }),
    db.file.aggregate({
      where: { deletedAt: { not: null } },
      _sum: { size: true },
    }),
    getSettings(),
    settingsSnapshot(),
    jobCounts(),
    db.job.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        attempts: true,
        lastError: true,
        payload: true,
        updatedAt: true,
      },
    }),
    lastReconcileReport(),
    db.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const stored = storedByUser.reduce(
    (total, row) => total + Number(row._sum.size ?? 0n),
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[0.9375rem] text-ink-90">Administration</h1>

      <Panel title="Accounts">
        <AdminUsers
          isRootActor={isRoot(session.user.role)}
          actorId={session.user.id}
          defaultQuotaBytes={
            settings.defaultQuotaBytes === null
              ? null
              : Number(settings.defaultQuotaBytes)
          }
          users={users.map((user) => {
            const stats = storedByUser.find((row) => row.ownerId === user.id);

            return {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role ?? "user",
              banned: user.banned,
              emailVerified: user.emailVerified,
              twoFactor: Boolean(user.twoFactorEnabled),
              fileCount: user._count.files,
              shareCount: user._count.shares,
              storedBytes: Number(stats?._sum.size ?? 0),
              quotaBytes:
                user.storageQuotaBytes === null
                  ? null
                  : Number(user.storageQuotaBytes),
            };
          })}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Storage">
          <StoragePanel
            stored={stored}
            trash={Number(trash._sum.size ?? 0n)}
            ceiling={
              settings.storageCeilingBytes === null
                ? null
                : Number(settings.storageCeilingBytes)
            }
            report={report}
          />
        </Panel>

        <Panel title="Background jobs">
          <JobsPanel
            counts={counts}
            failed={failed.map((job) => ({
              ...job,
              updatedAt: job.updatedAt.toISOString(),
            }))}
          />
        </Panel>
      </div>

      <Panel title="Settings">
        <SettingsPanel settings={snapshot} adminEmail={session.user.email} />
      </Panel>

      <Panel
        title={isRoot(session.user.role) ? "All files" : "Files you can manage"}
      >
        <AdminFiles
          files={files.map((file) => ({
            id: file.id,
            originalName: file.originalName,
            size: Number(file.size),
            createdAt: file.createdAt.toISOString(),
            ownerLabel: file.owner.name || file.owner.email,
            ownerRole: file.owner.role ?? "user",
            canDelete: canDeleteFile(actor, file.owner),
            canDownload: file.ownerId === session.user.id,
          }))}
        />

        {!isRoot(session.user.role) && (
          <p className="mt-3 border-t border-dotted border-ink-20 pt-3 text-[0.6875rem] leading-relaxed text-ink-60">
            Another admin&apos;s files are not listed here and cannot be deleted
            by you. Only root has authority over an admin account. Deleting
            someone else&apos;s file is permanent and is recorded below.
          </p>
        )}
      </Panel>

      <Panel title="Operator log">
        <AuditLog
          entries={audit.map((entry) => ({
            id: entry.id,
            action: entry.action,
            actorEmail: entry.actorEmail,
            targetLabel: entry.targetLabel,
            detail: entry.detail,
            ipAddress: entry.ipAddress,
            createdAt: entry.createdAt.toISOString(),
          }))}
        />
      </Panel>
    </div>
  );
}
