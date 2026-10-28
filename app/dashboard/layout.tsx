import { redirect } from "next/navigation";
import { VaultHeader } from "@/components/vault-header";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/invites";
import { getSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { nearLimit } from "@/lib/shares/attention";
import { guessedLinks } from "@/lib/shares/guessing";

export const metadata = {
  title: "Your vault",
  description: "Your stored files and the links you have sent out.",
  // A private surface: never indexed, never followed.
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Authoritative session check. proxy.ts only does an optimistic cookie
  // check and cannot be trusted for access control on its own.
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const [{ instanceName }, guessing, liveLinks] = await Promise.all([
    getSettings(),
    guessedLinks(session.user.id),
    db.share.findMany({
      where: {
        ownerId: session.user.id,
        revokedAt: null,
        type: "SEND",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: {
        maxDownloads: true,
        downloadCount: true,
        egressLimitBytes: true,
        egressUsedBytes: true,
      },
    }),
  ]);

  // The header's dot on "Shared links": the same two reasons the links page
  // explains in words.
  const attention =
    guessing.length > 0 ||
    liveLinks.some((share) =>
      nearLimit({
        maxDownloads: share.maxDownloads,
        downloadCount: share.downloadCount,
        egressLimitBytes:
          share.egressLimitBytes === null
            ? null
            : Number(share.egressLimitBytes),
        egressUsedBytes: Number(share.egressUsedBytes),
      }),
    );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <VaultHeader
        name={session.user.name}
        email={session.user.email}
        role={session.user.role ?? "user"}
        instanceName={instanceName}
        isAdmin={isAdmin(session.user.role)}
        attention={attention}
      />

      <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 pb-10 pt-8 sm:px-8 sm:pt-10">
        {children}
      </main>

      <footer className="mx-auto w-full max-w-[1360px] px-4 pb-7 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[12.5px] text-fg-subtle">
          <span>© {instanceName}</span>
          <span>
            Every download is recorded against the link that served it.
          </span>
        </div>
      </footer>
    </div>
  );
}
