import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminFiles } from "@/components/admin-files";
import { AdminUsers } from "@/components/admin-users";
import { Panel } from "@/components/world/panel";
import { db } from "@/lib/db";
import { isAdmin, isRoot } from "@/lib/invites";
import { canDeleteFile, deletableFileWhere } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export const metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const session = await getSession();

  // 404 rather than 403: an ordinary user should not learn this route exists.
  if (!session || !isAdmin(session.user.role)) notFound();

  const actor = { id: session.user.id, role: session.user.role };

  const [users, files] = await Promise.all([
    db.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        banned: true,
        emailVerified: true,
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
  ]);

  const storedByUser = await db.file.groupBy({
    by: ["ownerId"],
    _sum: { size: true },
    _count: { _all: true },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[0.9375rem] text-ink-90">Administration</h1>
        <Link
          href="/dashboard"
          className="text-[0.75rem] text-ink-60 underline underline-offset-4 hover:text-ink-100"
        >
          Back to your vault
        </Link>
      </div>

      <Panel title="Accounts">
        <AdminUsers
          isRootActor={isRoot(session.user.role)}
          actorId={session.user.id}
          users={users.map((user) => {
            const stats = storedByUser.find((row) => row.ownerId === user.id);

            return {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role ?? "user",
              banned: user.banned,
              emailVerified: user.emailVerified,
              fileCount: user._count.files,
              shareCount: user._count.shares,
              storedBytes: Number(stats?._sum.size ?? 0),
            };
          })}
        />
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
          }))}
        />

        {!isRoot(session.user.role) && (
          <p className="mt-3 border-t border-dotted border-ink-20 pt-3 text-[0.6875rem] leading-relaxed text-ink-60">
            Another admin&apos;s files are not listed here and cannot be deleted
            by you. Only root has authority over an admin account.
          </p>
        )}
      </Panel>
    </div>
  );
}
