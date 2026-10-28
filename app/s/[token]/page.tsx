import { Eye, KeyRound } from "lucide-react";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { ShareTree } from "@/components/share-tree";
import ShareUnlock from "@/components/share-unlock";
import { Button } from "@/components/ui/button";
import { IconDownload } from "@/components/world/icons";
import { db } from "@/lib/db";
import { formatBytes, formatRemaining } from "@/lib/format";
import { queueOwedScans } from "@/lib/scan";
import { flattenShareContents, shareContents } from "@/lib/shares/contents";
import {
  downloadsExhausted,
  downloadsLeft,
  formatDownloads,
} from "@/lib/shares/downloads";
import { guardSharePage } from "@/lib/shares/page-guard";
import { publiclyServable, scanRules } from "@/lib/shares/request";
import { scanCaution, scanConcern } from "@/lib/shares/withheld";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const share = await db.share.findUnique({ where: { token } });

  // A collection link's token opens the upload page, never this one.
  if (share?.type !== "SEND") notFound();

  const verdict = await guardSharePage(share);

  if (!verdict.ok) {
    if (verdict.reason === "PASSWORD_REQUIRED") {
      return <ShareUnlock token={token} name={share.name} />;
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
      <main className="flex flex-1 flex-col justify-center gap-3">
        <span className="stamp rise text-warn">{closed.tag}</span>
        <h1 className="rise text-balance font-serif text-[34px] font-medium leading-[1.15] tracking-[-0.02em] text-fg">
          {closed.title}
        </h1>
        <p className="rise text-[15px] leading-relaxed text-fg-muted">
          {closed.body}
        </p>
      </main>
    );
  }

  // Resolved rather than read off the row: a share can carry folders, whose
  // contents are decided now, not when the link was made.
  const contents = await shareContents(share);
  const files = flattenShareContents(contents);

  // Files this visitor would find withheld for want of a verdict go to the
  // front of the scan queue — after the page is sent, so it never waits.
  const rules = await scanRules();
  const unscanned = files
    .filter((file) => scanConcern(file, rules.scanning) === "UNSCANNED")
    .map((file) => file.id);

  if (unscanned.length > 0) {
    after(async () => {
      await queueOwedScans({ fileIds: unscanned });
    });
  }
  const totalBytes = files.reduce(
    (total, file) => total + Number(file.size),
    0,
  );
  const remaining = formatRemaining(share.expiresAt);
  const exhausted = downloadsExhausted(share.downloadCount, share.maxDownloads);
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
    (file) =>
      !file.isEncrypted &&
      publiclyServable(file, rules) &&
      !scanCaution(file, rules),
  );
  const archiveBytes = archivable.reduce(
    (total, file) => total + Number(file.size),
    0,
  );
  const offerArchive = !share.viewOnly && !exhausted && archivable.length > 1;

  const left =
    share.maxDownloads === null
      ? null
      : downloadsLeft(share.downloadCount, share.maxDownloads);

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-col gap-2.5">
        <span className="stamp rise">
          Shared with you · {files.length} file{files.length === 1 ? "" : "s"} ·{" "}
          {formatBytes(totalBytes)}
        </span>
        <h1
          className="rise text-balance break-words font-serif text-[34px] font-medium leading-[1.15] tracking-[-0.02em] text-fg sm:text-[40px]"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          {share.name ??
            `${files.length} file${files.length === 1 ? "" : "s"} for you`}
        </h1>

        {share.description && (
          <blockquote
            className="rise mt-1 whitespace-pre-line break-words font-serif text-[19px] italic leading-normal text-fg-muted"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            “{share.description}”
          </blockquote>
        )}
      </div>

      {/*
        The two limits a recipient can run into, stated before they reach
        for a button: when the link stops working, and how many downloads it
        has left.
      */}
      <dl
        className="rise grid grid-cols-2 border-y border-line"
        style={{ "--i": 3 } as React.CSSProperties}
      >
        <div className="flex flex-col gap-1 py-3.5 pr-4">
          <dt className="label-caps">Available</dt>
          <dd className="data text-sm text-fg">
            {remaining === null ? "No end date" : remaining}
          </dd>
        </div>
        <div className="flex flex-col gap-1 border-l border-line py-3.5 pl-4">
          <dt className="label-caps">Downloads left</dt>
          <dd
            className={
              left !== null && left <= 1
                ? "data text-sm text-warn"
                : "data text-sm text-fg"
            }
          >
            {share.viewOnly
              ? "Preview only"
              : left === null || share.maxDownloads === null
                ? "No limit"
                : `${formatDownloads(left)} of ${share.maxDownloads}${left > 0 && left <= 1 ? " · last one" : ""}`}
          </dd>
        </div>
      </dl>

      {offerArchive && (
        <div
          className="rise flex flex-col gap-2"
          style={{ "--i": 4 } as React.CSSProperties}
        >
          <Button
            asChild
            variant="primary"
            size="lg"
            className="h-12 text-base"
          >
            <a href={`/api/s/${token}/archive`}>
              <IconDownload className="size-[18px]" />
              Download all
              <span className="data text-[13px] opacity-80">
                · {formatBytes(archiveBytes)} zip
              </span>
            </a>
          </Button>
          <p className="text-center text-[13.5px] leading-relaxed text-fg-subtle">
            {left !== null && left <= 1
              ? "Uses the last download, so save it somewhere safe."
              : "Counts as one download."}
          </p>
        </div>
      )}

      {/*
        The recipient is owed the reason their download behaves differently
        here — and the reason a truncated link fails, which is otherwise the
        most baffling way this page can break.
      */}
      {hasEncrypted && (
        <div className="flex gap-3 rounded-xl bg-e2e-soft p-4">
          <KeyRound
            aria-hidden="true"
            className="mt-0.5 size-[18px] shrink-0 text-e2e"
            strokeWidth={1.75}
          />
          <p className="text-[13.5px] leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">
              These files were locked in the sender's browser and are unlocked
              again in yours.
            </span>{" "}
            The key travels in the part of the link after the #, which browsers
            never send to a server — so this server is handing you bytes it
            cannot read itself. If a file says its key is missing, the link
            arrived cut short; ask the sender for the whole thing.
          </p>
        </div>
      )}

      {/*
        Kept separate from the message above on purpose. That one teaches "key
        missing means your link was truncated"; this case is not that, and
        folding the two together would blunt a warning that needs to stay sharp.
      */}
      {hasKeyless && (
        <p className="rounded-xl bg-warn-soft p-4 text-[13.5px] leading-relaxed text-fg-muted">
          <span className="font-medium text-fg">
            Some files here were added to this folder after the link was made.
          </span>{" "}
          Locked files added later cannot be opened with this link — its key was
          fixed when it was created. Nothing is wrong with the link you have;
          ask the sender for a fresh one to get those files.
        </p>
      )}

      <section
        aria-labelledby="share-files"
        className="rise flex flex-col gap-3"
        style={{ "--i": 5 } as React.CSSProperties}
      >
        <h2 id="share-files" className="label-caps">
          In this link
        </h2>
        <ShareTree
          contents={contents}
          token={token}
          viewOnly={share.viewOnly}
          exhausted={exhausted}
          rules={rules}
        />
      </section>

      <p className="flex gap-2 text-[13.5px] leading-relaxed text-fg-muted">
        <Eye
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-fg-subtle"
          strokeWidth={1.75}
        />
        Downloads from this link are recorded for the person who sent it.
      </p>
    </main>
  );
}
