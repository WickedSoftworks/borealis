import { notFound } from "next/navigation";
import { ReverseUploader } from "@/components/reverse-uploader";
import { DataRow, Panel } from "@/components/world/panel";
import { db } from "@/lib/db";
import { formatBytes, formatRemaining } from "@/lib/format";
import { isExpired } from "@/lib/shares/expiry";

export const metadata = {
  title: "Send files",
  description: "Send files through Borealis.",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Reverse share: a link that collects files instead of serving them.
 *
 * Anonymous visitors upload into the owner's vault. The token is the only
 * credential, so the limits set on it are the only thing standing between a
 * leaked link and someone filling the operator's disk.
 */
export default async function ReverseSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const share = await db.share.findUnique({
    where: { token },
    include: { _count: { select: { items: true } } },
  });

  if (!share || share.type !== "REVERSE") notFound();
  if (share.revokedAt) notFound();

  const closed = isExpired(share.expiresAt);
  const full =
    share.maxUploadFiles !== null && share._count.items >= share.maxUploadFiles;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-10">
      <h1 className="text-[1.5rem] leading-tight text-ink-90 sm:text-[1.75rem]">
        {share.name ?? "Send files"}
      </h1>

      {share.description && (
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-60">
          {share.description}
        </p>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <Panel title="Upload">
          {closed || full ? (
            <p className="py-6 text-center text-[0.8125rem] text-ink-80">
              {closed
                ? "This link has closed. Ask whoever sent it for a new one."
                : "This link has received all the files it will accept."}
            </p>
          ) : (
            <ReverseUploader
              token={token}
              requireUploader={share.requireUploader}
              maxBytes={
                share.maxUploadBytes ? Number(share.maxUploadBytes) : null
              }
            />
          )}
        </Panel>

        <Panel title="This link" className="sm:w-56">
          <DataRow label="Closes">
            {formatRemaining(share.expiresAt) ?? "Never"}
          </DataRow>
          {share.maxUploadFiles !== null && (
            <DataRow label="Files left">
              {Math.max(0, share.maxUploadFiles - share._count.items)}
            </DataRow>
          )}
          {share.maxUploadBytes !== null && (
            <DataRow label="Max size">
              {formatBytes(Number(share.maxUploadBytes))}
            </DataRow>
          )}
        </Panel>
      </div>

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-dotted border-ink-20 pt-4 text-[0.6875rem] text-ink-60">
        <span>
          Files you send here go only to the person who gave you this link.
        </span>
        <span className="uppercase tracking-[0.22em]">Borealis</span>
      </footer>
    </main>
  );
}
