import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { EncryptedDownload } from "@/components/share-download";
import ShareUnlock from "@/components/share-unlock";
import { Button } from "@/components/ui/button";
import { IconDownload, IconFile } from "@/components/world/icons";
import { DensityMeter } from "@/components/world/meter";
import { DataRow, Panel, StateTag } from "@/components/world/panel";
import { db } from "@/lib/db";
import { formatBytes, formatRemaining } from "@/lib/format";
import { guardShare, unlockCookieName } from "@/lib/shares/guard";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const share = await db.share.findUnique({
    where: { token },
    include: { items: { include: { file: true } } },
  });

  if (!share) notFound();

  const cookieStore = await cookies();
  const unlockToken = cookieStore.get(unlockCookieName(share.id))?.value;
  const verdict = guardShare(share, { unlockToken });

  if (!verdict.ok) {
    if (verdict.reason === "PASSWORD_REQUIRED") {
      return <ShareUnlock token={token} name={share.name} />;
    }

    if (verdict.reason === "NOT_FOUND" || verdict.reason === "REVOKED") {
      notFound();
    }

    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md border border-dotted border-ink-20 p-5 text-center">
          <StateTag tone="alarm">
            {verdict.reason === "EXPIRED" ? "Expired" : "Limit reached"}
          </StateTag>

          <h1 className="mt-4 text-[0.9375rem] text-ink-90">
            This link is closed
          </h1>

          <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-60">
            {verdict.reason === "EXPIRED"
              ? "The clock on this link ran out. Ask whoever sent it for a new one."
              : "This link hit the limit its sender set. Ask them for a new one."}
          </p>
        </div>
      </main>
    );
  }

  const files = share.items.flatMap((item) => (item.file ? [item.file] : []));
  const totalBytes = files.reduce(
    (total, file) => total + Number(file.size),
    0,
  );
  const remaining = formatRemaining(share.expiresAt);
  const exhausted =
    share.maxDownloads !== null && share.downloadCount >= share.maxDownloads;
  const hasEncrypted = files.some((file) => file.isEncrypted);

  // Time left as a fraction of the share's whole lifespan, so the meter shows
  // the clock running down rather than an arbitrary scale.
  const expiryRatio = share.expiresAt
    ? (() => {
        const total = share.expiresAt.getTime() - share.createdAt.getTime();
        const left = share.expiresAt.getTime() - Date.now();
        return total > 0 ? { total, left: Math.max(0, left) } : null;
      })()
    : null;

  return (
    // Centred rather than pinned top-left: this page is the entire experience
    // for someone arriving cold from a chat message, so it should read as a
    // delivery, not a fragment stranded in the corner of a wide browser.
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-10">
      <h1 className="text-[1.5rem] leading-tight text-ink-90 sm:text-[1.75rem]">
        {share.name ??
          `${files.length} file${files.length === 1 ? "" : "s"} for you`}
      </h1>

      {share.description && (
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-60">
          {share.description}
        </p>
      )}

      {/*
        The recipient is owed the reason their download behaves differently
        here — and the reason a truncated link fails, which is otherwise the
        most baffling way this page can break.
      */}
      {hasEncrypted && (
        <p className="mt-4 border border-dotted border-ink-40 px-3 py-2.5 text-[0.75rem] leading-relaxed text-ink-60">
          <span className="text-ink-90">
            These files were locked in the sender's browser and are unlocked
            again in yours.
          </span>{" "}
          The key travels in the part of the link after the #, which browsers
          never send to a server — so this server is handing you bytes it cannot
          read itself. If a file says its key is missing, the link arrived cut
          short; ask the sender for the whole thing.
        </p>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <Panel title="Files" bodyClassName="p-0">
          <ul>
            {files.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-3 border-b border-dotted border-ink-20 px-3 py-2.5 last:border-b-0"
              >
                <IconFile className="size-4 shrink-0 text-ink-60" />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8125rem] text-ink-80">
                    {file.originalName}
                  </p>
                  <p className="text-[0.6875rem] tabular-nums text-ink-60">
                    {formatBytes(Number(file.size))}
                  </p>
                </div>

                {/*
                  The meter can read empty while the buttons stay live, which
                  invites a click that will only 410. When the link is spent,
                  the control says so instead.
                */}
                {share.viewOnly ? (
                  <StateTag tone="quiet">View only</StateTag>
                ) : exhausted ? (
                  <StateTag tone="alarm">No downloads left</StateTag>
                ) : file.isEncrypted ? (
                  <EncryptedDownload
                    token={token}
                    fileId={file.id}
                    filename={file.originalName}
                    mimeType={file.mimeType}
                  />
                ) : (
                  <Button asChild variant="primary" size="sm">
                    <a href={`/api/s/${token}/download/${file.id}`}>
                      <IconDownload className="size-3.5" />
                      Get
                    </a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        {/*
          The recipient gets the same instrument the operator does. Showing
          them a flat "1 download left" withholds the one thing this world is
          built to communicate — a quantity visibly running down.
        */}
        <Panel title="This link" className="sm:w-60">
          <DataRow label="Total">{formatBytes(totalBytes)}</DataRow>

          {share.maxDownloads !== null ? (
            <div className="py-2">
              <DensityMeter
                label="Downloads left"
                value={Math.max(0, share.maxDownloads - share.downloadCount)}
                max={share.maxDownloads}
                cells={16}
                readout={`${Math.max(0, share.maxDownloads - share.downloadCount)} of ${share.maxDownloads}`}
                tone={
                  share.downloadCount >= share.maxDownloads - 1
                    ? "alarm"
                    : "normal"
                }
              />
            </div>
          ) : (
            <DataRow label="Downloads">No limit</DataRow>
          )}

          {expiryRatio !== null ? (
            <div className="py-2">
              <DensityMeter
                label="Time left"
                value={expiryRatio.left}
                max={expiryRatio.total}
                cells={16}
                readout={remaining ?? "—"}
                tone={
                  expiryRatio.left / expiryRatio.total < 0.15
                    ? "alarm"
                    : "normal"
                }
              />
            </div>
          ) : (
            <DataRow label="Expires">Never</DataRow>
          )}
        </Panel>
      </div>

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-dotted border-ink-20 pt-4 text-[0.6875rem] text-ink-60">
        <span>
          Downloads from this link are recorded for the person who sent it.
        </span>
        <span className="uppercase tracking-[0.22em]">Borealis</span>
      </footer>
    </main>
  );
}
