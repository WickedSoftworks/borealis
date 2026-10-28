"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EditShareDialog } from "@/components/edit-share-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/world/dialog";
import { IconCheck } from "@/components/world/icons";
import { DensityMeter } from "@/components/world/meter";
import { StateTag } from "@/components/world/panel";
import { QrCode } from "@/components/world/qr";
import { encodeKeyFragment } from "@/lib/crypto/fragment";
import { partitionByKey } from "@/lib/crypto/keyring";
import { formatBytes, formatRemaining } from "@/lib/format";
import { GUESSING_THRESHOLD, nearLimit } from "@/lib/shares/attention";
import { downloadsExhausted, formatDownloads } from "@/lib/shares/downloads";

export type ShareRow = {
  id: string;
  token: string;
  /** SEND serves files out; REVERSE collects them in. */
  kind: "SEND" | "REVERSE";
  name: string | null;
  createdAt: string;
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
  /** Wrong passwords inside the lockout window. */
  recentFailures: number;
};

type Status = {
  label: string;
  tone: "active" | "alarm" | "normal";
};

/** One word for where a link stands, in the order an owner should care. */
function statusOf(share: ShareRow, ended: boolean): Status {
  if (ended) return { label: "Ended", tone: "normal" };
  if (share.recentFailures >= GUESSING_THRESHOLD) {
    return { label: "Needs attention", tone: "alarm" };
  }
  if (share.kind === "SEND" && nearLimit(share)) {
    return { label: "Near its limit", tone: "alarm" };
  }
  return {
    label: share.kind === "REVERSE" ? "Collecting" : "Active",
    tone: "active",
  };
}

/**
 * Live links, each showing what is left of it.
 *
 * The caps are the point of this list — a link is only as safe as the
 * ceiling on it — so every link shows its time, downloads and transfer side
 * by side, filled as they are spent, with the figure beside each bar. A limit
 * the link does not have is drawn as an open dashed line rather than left
 * out, so "no cap" is visible as a choice.
 */
export function ShareTable({
  shares,
  now,
  emptyMessage = "No links out. Send some files to make one.",
}: {
  shares: ShareRow[];
  /** The server's clock as ISO, so time bars render the same on both sides. */
  now: string;
  emptyMessage?: string;
}) {
  const router = useRouter();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [qr, setQr] = useState<{ url: string; label: string } | null>(null);

  const nowMs = new Date(now).getTime();

  /** The full link, key fragment included when this browser holds the keys. */
  function fullUrl(share: ShareRow, path: string) {
    const { known, missing } = partitionByKey(share.encryptedFileIds);
    return {
      url: `${window.location.origin}${path}${encodeKeyFragment(known)}`,
      missing,
    };
  }

  /**
   * Copying a link to an encrypted share has to rebuild its key fragment from
   * this browser's keyring. The server cannot supply it — that is the whole
   * point — so a plain copy of the path would hand over a link nobody can open.
   */
  async function copy(share: ShareRow, path: string) {
    const { url, missing } = fullUrl(share, path);

    await navigator.clipboard.writeText(url);

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
    setConfirming(null);
    router.refresh();
  }

  if (shares.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-fg-subtle">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="border-t border-line">
      {shares.map((share) => {
        const remaining = formatRemaining(share.expiresAt, nowMs);
        const collecting = share.kind === "REVERSE";
        const path = `${collecting ? "/r/" : "/s/"}${share.token}`;
        const label =
          share.name ??
          (collecting
            ? "Untitled collection link"
            : `${share.fileCount} file${share.fileCount === 1 ? "" : "s"}`);

        const spentDownloads =
          share.maxDownloads !== null &&
          downloadsExhausted(share.downloadCount, share.maxDownloads);
        const spentTransfer =
          share.egressLimitBytes !== null &&
          share.egressUsedBytes >= share.egressLimitBytes;
        const ended =
          remaining === "expired" ||
          (!collecting && (spentDownloads || spentTransfer));
        const status = statusOf(share, ended);

        // How much of the link's window has passed: zero at creation, full at
        // expiry. Measured against the server's clock, not this browser's.
        const created = new Date(share.createdAt).getTime();
        const expires = share.expiresAt
          ? new Date(share.expiresAt).getTime()
          : null;
        const elapsed =
          expires && expires > created
            ? Math.min(1, Math.max(0, (nowMs - created) / (expires - created)))
            : 0;

        const meta = [
          collecting
            ? `${share.fileCount} received`
            : `${share.fileCount} file${share.fileCount === 1 ? "" : "s"}`,
          share.hasPassword && "password",
          share.viewOnly && "view only",
          share.encryptedFileIds.length > 0 && "end-to-end encrypted",
          path,
        ].filter(Boolean);

        return (
          <li
            key={share.id}
            className="flex flex-col gap-4 border-b border-line px-1 py-5 sm:px-2"
          >
            <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
              <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
                <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="font-serif text-[19px] font-semibold leading-snug tracking-[-0.012em] text-fg">
                    {label}
                  </span>
                  <StateTag tone={status.tone}>{status.label}</StateTag>
                </span>
                <span className="data break-all text-fg-subtle">
                  {meta.join(" · ")}
                </span>
              </div>

              <div className="grid flex-[2_1_420px] gap-x-6 gap-y-3 sm:grid-cols-3">
                <DensityMeter
                  label="Time"
                  value={elapsed}
                  max={1}
                  unbounded={expires === null}
                  readout={
                    remaining === null
                      ? "no end date"
                      : remaining === "expired"
                        ? "expired"
                        : remaining
                  }
                />

                {collecting ? (
                  <DensityMeter
                    label="Received"
                    value={share.fileCount}
                    max={share.maxUploadFiles ?? 0}
                    unbounded={share.maxUploadFiles === null}
                    tone={
                      share.maxUploadFiles !== null &&
                      share.fileCount >= share.maxUploadFiles
                        ? "alarm"
                        : "normal"
                    }
                    readout={
                      share.maxUploadFiles === null
                        ? `${share.fileCount} · no limit`
                        : `${share.fileCount} of ${share.maxUploadFiles}`
                    }
                  />
                ) : (
                  <>
                    <DensityMeter
                      label="Downloads"
                      value={share.downloadCount}
                      max={share.maxDownloads ?? 0}
                      unbounded={share.maxDownloads === null}
                      tone={
                        share.maxDownloads !== null &&
                        share.downloadCount >= share.maxDownloads - 1 &&
                        share.maxDownloads > 1
                          ? "alarm"
                          : "normal"
                      }
                      readout={
                        share.maxDownloads === null
                          ? `${formatDownloads(share.downloadCount)} · no limit`
                          : `${formatDownloads(share.downloadCount)} of ${share.maxDownloads}`
                      }
                    />
                    <DensityMeter
                      label="Transfer"
                      value={share.egressUsedBytes}
                      max={share.egressLimitBytes ?? 0}
                      unbounded={share.egressLimitBytes === null}
                      tone={
                        share.egressLimitBytes !== null &&
                        share.egressUsedBytes >= share.egressLimitBytes * 0.8
                          ? "alarm"
                          : "normal"
                      }
                      readout={
                        share.egressLimitBytes === null
                          ? `${formatBytes(share.egressUsedBytes)} · no cap`
                          : `${formatBytes(share.egressUsedBytes)} of ${formatBytes(share.egressLimitBytes)}`
                      }
                    />
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="default"
                size="sm"
                onClick={() => copy(share, path)}
              >
                {copiedToken === share.token ? (
                  <>
                    <IconCheck className="size-3.5" />
                    Copied
                  </>
                ) : (
                  "Copy link"
                )}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                aria-label={`Show a QR code for ${label}`}
                onClick={() => setQr({ url: fullUrl(share, path).url, label })}
              >
                QR code
              </Button>

              {/*
                Collection links have their own settings, which this dialog
                does not cover, so it is not offered for them.
              */}
              {!collecting && (
                <EditShareDialog shareId={share.id}>
                  <Button variant="ghost" size="sm">
                    Edit limits
                  </Button>
                </EditShareDialog>
              )}

              {/*
                Revoking cannot be undone and cuts off a recipient mid-download,
                so it asks first, in words that say exactly that.
              */}
              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                {confirming === share.id ? (
                  <>
                    <span className="text-[13px] text-fg-muted">
                      Revoke? It stops working for everyone, right away.
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirming(null)}
                    >
                      Keep link
                    </Button>
                    <Button
                      variant="danger-solid"
                      size="sm"
                      disabled={revoking === share.id}
                      onClick={() => revoke(share.id)}
                    >
                      {revoking === share.id ? "Revoking…" : "Revoke now"}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirming(share.id)}
                  >
                    Revoke…
                  </Button>
                )}
              </span>
            </div>
          </li>
        );
      })}

      {note && (
        <li className="py-3">
          <output className="block text-sm leading-relaxed text-fg">
            {note}
          </output>
        </li>
      )}

      {/*
        Links get sent to phones. A code on the screen saves typing a
        22-character token into one — and says, beside it, that whoever
        scans it holds the link.
      */}
      <Dialog open={qr !== null} onOpenChange={(open) => !open && setQr(null)}>
        {qr && (
          <DialogContent title={qr.label} className="max-w-xs">
            <div className="flex flex-col items-center gap-3">
              <QrCode
                value={qr.url}
                label={`QR code for ${qr.label}`}
                className="size-56 rounded-lg"
              />
              <p className="text-center text-[13px] leading-relaxed text-fg-subtle">
                Anyone who scans this has the link. Show it only to the person
                it is for.
              </p>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </ul>
  );
}
