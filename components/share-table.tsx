"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EditShareDialog } from "@/components/edit-share-dialog";
import { Button } from "@/components/ui/button";
import { IconCheck, IconClock, IconLock } from "@/components/world/icons";
import { DensityMeter } from "@/components/world/meter";
import { StateTag } from "@/components/world/panel";
import { encodeKeyFragment } from "@/lib/crypto/fragment";
import { partitionByKey } from "@/lib/crypto/keyring";
import { formatBytes, formatRemaining } from "@/lib/format";

export type ShareRow = {
  id: string;
  token: string;
  /** SEND serves files out; REVERSE collects them in. */
  kind: "SEND" | "REVERSE";
  name: string | null;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  egressLimitBytes: number | null;
  egressUsedBytes: number;
  hasPassword: boolean;
  viewOnly: boolean;
  /** Files carried, or — for a collection link — files received so far. */
  fileCount: number;
  maxUploadFiles: number | null;
  /** Ids of the carried files that are client-side encrypted, if any. */
  encryptedFileIds: string[];
};

/**
 * Live links, each showing what is left of it.
 *
 * The caps are the point of this table — a link is only as safe as the ceiling
 * on it, so what remains is drawn as depleting density rather than buried in a
 * detail view. A collection link is the same object filling up instead of
 * draining, so it belongs in the same table with its own meter.
 */
export function ShareTable({
  shares,
  emptyMessage = "No links out. Select files above to make one.",
}: {
  shares: ShareRow[];
  emptyMessage?: string;
}) {
  const router = useRouter();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /**
   * Copying a link to an encrypted share has to rebuild its key fragment from
   * this browser's keyring. The server cannot supply it — that is the whole
   * point — so a plain copy of the path would hand over a link nobody can open.
   */
  async function copy(share: ShareRow, path: string) {
    const { known, missing } = partitionByKey(share.encryptedFileIds);

    await navigator.clipboard.writeText(
      `${window.location.origin}${path}${encodeKeyFragment(known)}`,
    );

    setCopiedToken(share.token);
    setNote(
      missing.length > 0
        ? `Copied, but ${missing.length} encrypted file${missing.length === 1 ? "" : "s"} in this link had no key in this browser. The recipient will not be able to open ${missing.length === 1 ? "it" : "them"}.`
        : null,
    );
  }

  async function revoke(id: string) {
    setRevoking(id);
    await fetch(`/api/shares/${id}`, { method: "DELETE" });
    setRevoking(null);
    router.refresh();
  }

  if (shares.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[0.75rem] text-ink-60">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {shares.map((share) => {
        const remaining = formatRemaining(share.expiresAt);
        const expired = remaining === "expired";
        const collecting = share.kind === "REVERSE";
        const path = `${collecting ? "/r/" : "/s/"}${share.token}`;

        return (
          <li
            key={share.id}
            className="border border-dotted border-ink-20 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[0.8125rem] text-ink-80">
                {share.name ??
                  (collecting
                    ? `${share.fileCount} received`
                    : `${share.fileCount} file${share.fileCount === 1 ? "" : "s"}`)}
              </span>

              <div className="flex items-center gap-1.5">
                {collecting && <StateTag tone="quiet">Collecting</StateTag>}
                {share.hasPassword && (
                  <StateTag tone="quiet">
                    <IconLock className="mr-1 inline size-3 align-[-2px]" />
                    Password
                  </StateTag>
                )}
                {share.viewOnly && <StateTag tone="quiet">View only</StateTag>}
                <StateTag tone={expired ? "alarm" : "normal"}>
                  <IconClock className="mr-1 inline size-3 align-[-2px]" />
                  {remaining ?? "No expiry"}
                </StateTag>
              </div>
            </div>

            {/* A collection link fills rather than drains; same instrument. */}
            {collecting && share.maxUploadFiles !== null && (
              <div className="mt-3">
                <DensityMeter
                  label="Files received"
                  value={share.fileCount}
                  max={share.maxUploadFiles}
                  cells={20}
                  tone={
                    share.fileCount >= share.maxUploadFiles ? "alarm" : "normal"
                  }
                  readout={`${share.fileCount} of ${share.maxUploadFiles}`}
                />
              </div>
            )}

            {/*
              Wide gap plus a dotted rule between the two meters: side by side
              with a small gap, meter one's readout and meter two's label
              collide into a single unreadable run.
            */}
            {!collecting &&
              (share.maxDownloads !== null ||
                share.egressLimitBytes !== null) && (
                <div className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2 sm:divide-x sm:divide-dotted sm:divide-ink-20">
                  {share.maxDownloads !== null && (
                    <DensityMeter
                      label="Downloads used"
                      value={share.downloadCount}
                      max={share.maxDownloads}
                      cells={20}
                      tone={
                        share.downloadCount >= share.maxDownloads
                          ? "alarm"
                          : "normal"
                      }
                      readout={`${share.downloadCount} of ${share.maxDownloads}`}
                      className="sm:pr-8"
                    />
                  )}

                  {share.egressLimitBytes !== null && (
                    <DensityMeter
                      label="Transfer used"
                      value={share.egressUsedBytes}
                      max={share.egressLimitBytes}
                      cells={20}
                      tone={
                        share.egressUsedBytes >= share.egressLimitBytes
                          ? "alarm"
                          : "normal"
                      }
                      readout={`${formatBytes(share.egressUsedBytes)} of ${formatBytes(share.egressLimitBytes)}`}
                      className="sm:pl-8"
                    />
                  )}
                </div>
              )}

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span className="truncate text-[0.6875rem] text-ink-60">
                {path}
              </span>

              <div className="flex shrink-0 gap-1.5">
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => copy(share, path)}
                >
                  {copiedToken === share.token ? (
                    <>
                      <IconCheck className="size-3" />
                      Copied
                    </>
                  ) : (
                    "Copy link"
                  )}
                </Button>

                {/*
                  Collection links have their own settings, which this dialog
                  does not cover, so it is not offered for them.
                */}
                {!collecting && (
                  <EditShareDialog shareId={share.id}>
                    <Button variant="quiet" size="sm">
                      Edit
                    </Button>
                  </EditShareDialog>
                )}

                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => revoke(share.id)}
                  disabled={revoking === share.id}
                >
                  {revoking === share.id ? "Revoking…" : "Revoke"}
                </Button>
              </div>
            </div>
          </li>
        );
      })}

      {note && (
        <li>
          <output className="block text-[0.75rem] leading-relaxed text-ink-90">
            {note}
          </output>
        </li>
      )}
    </ul>
  );
}
