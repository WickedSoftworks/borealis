import { ShieldCheck } from "lucide-react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ReverseUploader } from "@/components/reverse-uploader";
import { db } from "@/lib/db";
import { formatBytes, formatRemaining } from "@/lib/format";
import { clientIp, parseCidrList } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { isExpired } from "@/lib/shares/expiry";
import { addressAllowed } from "@/lib/shares/guard";

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

  if (share?.type !== "REVERSE") notFound();
  if (share.revokedAt) notFound();

  const [{ deniedIps }, headerStore] = await Promise.all([
    getSettings(),
    headers(),
  ]);

  // The same address rule the upload endpoint enforces, so the page never
  // offers a field whose uploads would all be refused.
  const blocked = !addressAllowed(
    share.allowedIps,
    clientIp(headerStore),
    parseCidrList(deniedIps).ranges,
  );

  const closed = isExpired(share.expiresAt);
  const full =
    share.maxUploadFiles !== null && share._count.items >= share.maxUploadFiles;

  const filesLeft =
    share.maxUploadFiles === null
      ? null
      : Math.max(0, share.maxUploadFiles - share._count.items);

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-col gap-2.5">
        <span className="stamp rise">Someone asked you for files</span>
        <h1
          className="rise text-balance break-words font-serif text-[34px] font-medium leading-[1.15] tracking-[-0.02em] text-fg sm:text-[40px]"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          {share.name ?? "Send files"}
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

      <dl
        className="rise grid grid-cols-2 border-y border-line"
        style={{ "--i": 3 } as React.CSSProperties}
      >
        <div className="flex flex-col gap-1 py-3.5 pr-4">
          <dt className="label-caps">Open</dt>
          <dd className="data text-sm text-fg">
            {closed
              ? "Closed"
              : (formatRemaining(share.expiresAt) ?? "No end date")}
          </dd>
        </div>
        <div className="flex flex-col gap-1 border-l border-line py-3.5 pl-4">
          <dt className="label-caps">
            {filesLeft !== null ? "Files left" : "Largest file"}
          </dt>
          <dd className="data text-sm text-fg">
            {filesLeft !== null
              ? `${filesLeft} of ${share.maxUploadFiles}`
              : share.maxUploadBytes !== null
                ? formatBytes(Number(share.maxUploadBytes))
                : "No limit"}
          </dd>
        </div>
      </dl>

      <div className="rise" style={{ "--i": 4 } as React.CSSProperties}>
        {closed || full || blocked ? (
          <p className="rounded-xl border border-line bg-paper px-4 py-8 text-center text-[15px] leading-relaxed text-fg">
            {closed
              ? "This link has closed. Ask whoever sent it for a new one."
              : blocked
                ? "This link can't accept files from this network. If you think it should, tell whoever sent it which network you are on."
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
      </div>

      {filesLeft !== null && share.maxUploadBytes !== null && (
        <p className="data -mt-4 text-fg-subtle">
          Each file up to {formatBytes(Number(share.maxUploadBytes))}
        </p>
      )}

      <p className="flex gap-2 text-[13.5px] leading-relaxed text-fg-muted">
        <ShieldCheck
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-fg-subtle"
          strokeWidth={1.75}
        />
        Files you send here go only to the person who gave you this link.
      </p>
    </main>
  );
}
