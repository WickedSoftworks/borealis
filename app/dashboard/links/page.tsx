import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { AccessLog } from "@/components/access-log";
import { ReverseDialog } from "@/components/reverse-dialog";
import { ShareTable } from "@/components/share-table";
import { db } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import { getSession } from "@/lib/session";
import { formatDownloads } from "@/lib/shares/downloads";
import { guessedLinks } from "@/lib/shares/guessing";
import { FREE_ATTEMPTS } from "@/lib/shares/lockout";

export const metadata = {
  title: "Shared links",
  robots: { index: false, follow: false },
};

/**
 * Every link this account has out, what each one still allows, and what has
 * happened to them lately. The two directions — files going out, files coming
 * in — stay in separate lists: a stranger writing to this disk is not a
 * distinction to bury in a badge.
 */
export default async function LinksPage() {
  const session = await getSession();
  if (!session) return null;

  const [shares, accesses, guessing] = await Promise.all([
    db.share.findMany({
      where: { ownerId: session.user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { items: true } },
        // Only the encrypted ones matter here: copying a link has to rebuild
        // its key fragment from this browser's keyring.
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
    guessedLinks(session.user.id),
  ]);

  // One clock for every bar on the page, read once on the server.
  const now = new Date();

  const rows = shares.map((share) => ({
    id: share.id,
    token: share.token,
    kind: share.type === "REVERSE" ? ("REVERSE" as const) : ("SEND" as const),
    name: share.name,
    createdAt: share.createdAt.toISOString(),
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
    recentFailures:
      guessing.find((entry) => entry.shareId === share.id)?.failures ?? 0,
  }));

  const sendLinks = rows.filter((row) => row.kind === "SEND");
  const collectLinks = rows.filter((row) => row.kind === "REVERSE");

  const servedBytes = shares.reduce(
    (total, share) => total + Number(share.egressUsedBytes),
    0,
  );
  const downloads = shares.reduce(
    (total, share) => total + share.downloadCount,
    0,
  );

  const nameOf = (shareId: string) =>
    shares.find((share) => share.id === shareId)?.name || "Untitled link";

  return (
    <div className="flex flex-col gap-10">
      <div className="rise flex flex-col gap-1.5">
        <h1 className="font-serif text-4xl font-medium tracking-[-0.02em]">
          Shared links
        </h1>
        <p className="font-serif text-lg text-fg-muted">
          Every link has an end. Here is where each one stands.
        </p>
        <p className="data mt-1 text-fg-subtle">
          {sendLinks.length} sending · {collectLinks.length} collecting ·{" "}
          {formatDownloads(downloads)} downloads · {formatBytes(servedBytes)}{" "}
          served
        </p>
      </div>

      {guessing.length > 0 && (
        <div className="flex flex-col gap-2">
          {guessing.map((entry) => (
            <div
              key={entry.shareId}
              role="alert"
              className="flex items-start gap-3 rounded-[10px] bg-warn-soft px-4 py-3.5"
            >
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-[18px] shrink-0 text-warn"
                strokeWidth={1.75}
              />
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold">
                  Someone may be guessing the password for “
                  {nameOf(entry.shareId)}”
                </span>
                <span className="text-sm text-fg-muted">
                  {entry.failures} wrong tries in the last hour.
                  {entry.failures >= FREE_ATTEMPTS
                    ? " Each further try now has to wait longer, up to 15 minutes."
                    : ` After ${FREE_ATTEMPTS}, each further try has to wait longer.`}{" "}
                  Change the password to make every guess so far worthless, or
                  revoke the link.
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <section aria-labelledby="sending-label" className="flex flex-col gap-4">
        <h2 id="sending-label" className="label-caps">
          Sending
        </h2>
        <ShareTable shares={sendLinks} now={now.toISOString()} />
      </section>

      {/*
        Collection links point the opposite way — a stranger writing to this
        disk — so they get their own list and their own action.
      */}
      <section aria-labelledby="collect-label" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="collect-label" className="label-caps">
            Collecting
          </h2>
          <ReverseDialog />
        </div>
        <ShareTable
          shares={collectLinks}
          now={now.toISOString()}
          emptyMessage="No collection links. Make one to let someone send you files without an account."
        />
      </section>

      <section aria-labelledby="recent-label" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="recent-label" className="label-caps">
            Recent activity
          </h2>
          <Link href="/dashboard/activity" className="link-quiet text-[13px]">
            Full log →
          </Link>
        </div>
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
            uploaderName: entry.uploaderName,
          }))}
        />
      </section>
    </div>
  );
}
