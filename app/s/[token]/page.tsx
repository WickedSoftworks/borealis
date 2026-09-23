import { notFound } from "next/navigation";
import { ShareTree } from "@/components/share-tree";
import ShareUnlock from "@/components/share-unlock";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { IconDownload } from "@/components/world/icons";
import { DensityMeter } from "@/components/world/meter";
import { DataRow, Panel, StateTag } from "@/components/world/panel";
import { db } from "@/lib/db";
import { formatBytes, formatRemaining } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { flattenShareContents, shareContents } from "@/lib/shares/contents";
import { guardSharePage } from "@/lib/shares/page-guard";
import { publiclyServable } from "@/lib/shares/request";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const share = await db.share.findUnique({ where: { token } });

  // A collection link's token opens the upload page, never this one.
  if (!share || share.type !== "SEND") notFound();

  const [verdict, { instanceName }] = await Promise.all([
    guardSharePage(share),
    getSettings(),
  ]);

  if (!verdict.ok) {
    if (verdict.reason === "PASSWORD_REQUIRED") {
      return (
        <ShareUnlock
          token={token}
          name={share.name}
          instanceName={instanceName}
        />
      );
    }

    if (verdict.reason === "NOT_FOUND" || verdict.reason === "REVOKED") {
      notFound();
    }

    const closed =
      verdict.reason === "EXPIRED"
        ? {
            tag: "Expired",
            title: "This link is closed",
            body: "The clock on this link ran out. Ask whoever sent it for a new one.",
          }
        : verdict.reason === "ADDRESS_DENIED"
          ? {
              tag: "Not from here",
              title: "This link can't be opened from this network",
              body: "Whoever sent it limited it to particular addresses, and this connection is not one of them. If you think it should be, tell them which network you are on.",
            }
          : {
              tag: "Limit reached",
              title: "This link is closed",
              body: "This link hit the limit its sender set. Ask them for a new one.",
            };

    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md border border-dotted border-ink-20 p-5 text-center">
          <StateTag tone="alarm">{closed.tag}</StateTag>

          <h1 className="mt-4 text-[0.9375rem] text-ink-90">{closed.title}</h1>

          <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-60">
            {closed.body}
          </p>
        </div>
      </main>
    );
  }

  // Resolved rather than read off the row: a share can carry folders, whose
  // contents are decided now, not when the link was made.
  const contents = await shareContents(share);
  const files = flattenShareContents(contents);
  const totalBytes = files.reduce(
    (total, file) => total + Number(file.size),
    0,
  );
  const remaining = formatRemaining(share.expiresAt);
  const exhausted =
    share.maxDownloads !== null && share.downloadCount >= share.maxDownloads;
  const hasEncrypted = files.some((file) => file.isEncrypted);
  // Arrived through a shared folder after this link was sent, so no key for it
  // was ever in the fragment.
  const hasKeyless = files.some(
    (file) => file.isEncrypted && file.addedAfterShare,
  );

  // What the one-click archive would carry: everything the server can read
  // and may serve. Offered only when it would hold more than one file — for
  // a single file the row's own button is the same thing, faster.
  const archivable = files.filter(
    (file) => !file.isEncrypted && publiclyServable(file),
  );
  const archiveBytes = archivable.reduce(
    (total, file) => total + Number(file.size),
    0,
  );
  const offerArchive = !share.viewOnly && !exhausted && archivable.length > 1;

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
        <p className="mt-2 whitespace-pre-line text-[0.8125rem] leading-relaxed text-ink-60">
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

      {/*
        Kept separate from the message above on purpose. That one teaches "key
        missing means your link was truncated"; this case is not that, and
        folding the two together would blunt a warning that needs to stay sharp.
      */}
      {hasKeyless && (
        <p className="mt-3 border border-dotted border-ink-40 px-3 py-2.5 text-[0.75rem] leading-relaxed text-ink-60">
          <span className="text-ink-90">
            Some files here were added to this folder after the link was made.
          </span>{" "}
          Locked files added later cannot be opened with this link — its key was
          fixed when it was created. Nothing is wrong with the link you have;
          ask the sender for a fresh one to get those files.
        </p>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <Panel
          title="Files"
          bodyClassName="p-0"
          actions={
            offerArchive ? (
              <Button asChild variant="primary" size="sm">
                <a href={`/api/s/${token}/archive`}>
                  <IconDownload className="size-3.5" />
                  Get all · {formatBytes(archiveBytes)}
                </a>
              </Button>
            ) : undefined
          }
        >
          <ShareTree
            contents={contents}
            token={token}
            viewOnly={share.viewOnly}
            exhausted={exhausted}
          />
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

          {offerArchive && (
            <p className="border-t border-dotted border-ink-20 pt-2 text-[0.6875rem] leading-relaxed text-ink-60">
              “Get all” counts as one download.
            </p>
          )}
        </Panel>
      </div>

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-dotted border-ink-20 pt-4 text-[0.6875rem] text-ink-60">
        <span>
          Downloads from this link are recorded for the person who sent it.
        </span>
        <span className="flex items-center gap-2">
          <ThemeToggle />
          <span className="uppercase tracking-[0.22em]">{instanceName}</span>
        </span>
      </footer>
    </main>
  );
}
