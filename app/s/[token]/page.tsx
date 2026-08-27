import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ShareTree } from "@/components/share-tree";
import ShareUnlock from "@/components/share-unlock";
import { DensityMeter } from "@/components/world/meter";
import { DataRow, Panel, StateTag } from "@/components/world/panel";
import { db } from "@/lib/db";
import { formatBytes, formatRemaining } from "@/lib/format";
import { flattenShareContents, shareContents } from "@/lib/shares/contents";
import { guardShare, unlockCookieName } from "@/lib/shares/guard";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const share = await db.share.findUnique({ where: { token } });

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
        <Panel title="Files" bodyClassName="p-0">
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
