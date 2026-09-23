"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DensityMeter } from "@/components/world/meter";
import { ErrorSlab, Notice } from "@/components/world/notice";
import { DataRow } from "@/components/world/panel";
import { formatBytes } from "@/lib/format";

export type ReconcileView = {
  at: string;
  scanned: number;
  orphans: number;
  orphanBytes: number;
  deleted: number;
  failed: number;
  sample: string[];
};

/**
 * What the instance is holding, against the ceiling the operator chose, and
 * whether the store holds anything the database has forgotten.
 *
 * Orphans are reported, not removed, until someone presses the button — see
 * lib/reconcile.ts for the restored-backup case that makes an automatic
 * delete dangerous. The sample of keys is there so the decision is made
 * looking at what would go.
 */
export function StoragePanel({
  stored,
  trash,
  ceiling,
  report,
}: {
  stored: number;
  trash: number;
  ceiling: number | null;
  report: ReconcileView | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"scan" | "remove" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [current, setCurrent] = useState(report);

  async function run(remove: boolean) {
    setBusy(remove ? "remove" : "scan");
    setError(null);
    setNotice(null);

    const response = await fetch("/api/admin/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remove }),
    });
    const body = await response.json().catch(() => null);

    setBusy(null);
    setConfirming(false);

    if (!response.ok) {
      setError(body?.error ?? "The check did not complete.");
      return;
    }

    setCurrent(body.report);
    setNotice(
      remove
        ? `Removed ${body.report.deleted} object${body.report.deleted === 1 ? "" : "s"}${
            body.report.failed
              ? `; ${body.report.failed} could not be removed`
              : ""
          }.`
        : `Checked ${body.report.scanned} object${body.report.scanned === 1 ? "" : "s"}.`,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {ceiling !== null ? (
        <DensityMeter
          label="Instance storage"
          value={stored}
          max={ceiling}
          cells={24}
          tone={stored / ceiling >= 0.9 ? "alarm" : "normal"}
          readout={`${formatBytes(stored)} of ${formatBytes(ceiling)}`}
        />
      ) : (
        <DataRow label="Stored">{formatBytes(stored)}</DataRow>
      )}
      <DataRow label="In trash">{formatBytes(trash)}</DataRow>

      <div className="border-t border-dotted border-ink-20 pt-3">
        <p className="text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
          Unreferenced objects
        </p>

        {current ? (
          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-80">
            {current.orphans === 0
              ? `None. Last checked ${new Date(current.at).toLocaleString()}, ${current.scanned} objects.`
              : `${current.orphans} object${current.orphans === 1 ? "" : "s"}, ${formatBytes(current.orphanBytes)}, that no file points at — checked ${new Date(current.at).toLocaleString()}.`}
          </p>
        ) : (
          <p className="mt-1.5 text-[0.75rem] text-ink-60">
            Not checked yet. It runs daily.
          </p>
        )}

        {current && current.orphans > 0 && (
          <>
            <ul className="mt-2 font-mono text-[0.6875rem] text-ink-60">
              {current.sample.map((key) => (
                <li key={key} className="truncate">
                  {key}
                </li>
              ))}
              {current.orphans > current.sample.length && (
                <li>…and {current.orphans - current.sample.length} more</li>
              )}
            </ul>
            <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-60">
              Usually left by a crash mid-upload or a failed deletion. If you
              have just restored the database from a backup, these may be files
              uploaded since that backup — do not remove them.
            </p>
          </>
        )}

        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button
            variant="quiet"
            size="sm"
            disabled={busy !== null}
            onClick={() => run(false)}
          >
            {busy === "scan" ? "Checking…" : "Check now"}
          </Button>

          {current &&
            current.orphans > 0 &&
            (confirming ? (
              <span className="flex items-center gap-1.5">
                <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-ink-90">
                  Remove for good?
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => run(true)}
                >
                  {busy === "remove" ? "…" : "Yes"}
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => setConfirming(false)}
                >
                  No
                </Button>
              </span>
            ) : (
              <Button
                variant="default"
                size="sm"
                disabled={busy !== null}
                onClick={() => setConfirming(true)}
              >
                Remove them
              </Button>
            ))}
        </div>
      </div>

      <ErrorSlab>{error}</ErrorSlab>
      <Notice>{notice}</Notice>
    </div>
  );
}
