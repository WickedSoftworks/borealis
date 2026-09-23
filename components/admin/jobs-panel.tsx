"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSlab, Notice } from "@/components/world/notice";
import { DataRow, StateTag } from "@/components/world/panel";

export type FailedJob = {
  id: string;
  type: string;
  attempts: number;
  lastError: string | null;
  payload: string;
  updatedAt: string;
};

const TYPE_LABEL: Record<string, string> = {
  EXTRACT_TEXT: "Index text",
  CHECKSUM: "Checksum",
  EXPIRE_SWEEP: "Hourly sweep",
  NOTIFY_DOWNLOAD: "Download email",
  PURGE_FILE: "Purge from trash",
  THUMBNAIL: "Thumbnail",
  SCAN_FILE: "Malware scan",
  RECONCILE_STORAGE: "Storage check",
};

/**
 * The background queue, from the operator's side.
 *
 * A job that runs out of retries stops at FAILED and the worker never looks at
 * it again; before this panel, the only trace was a line in stdout. Each one
 * shows what it was, why it failed, and can be retried — after fixing the
 * cause — or discarded.
 */
export function JobsPanel({
  counts,
  failed,
}: {
  counts: { PENDING: number; RUNNING: number; FAILED: number };
  failed: FailedJob[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(url: string, key: string, body?: unknown) {
    setBusy(key);
    setError(null);
    setNotice(null);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => null);

    setBusy(null);

    if (!response.ok) {
      setError(result?.error ?? "That did not work.");
      return;
    }

    if (result?.retried !== undefined) {
      setNotice(
        `Queued ${result.retried} job${result.retried === 1 ? "" : "s"} again.`,
      );
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <DataRow label="Waiting">{counts.PENDING}</DataRow>
        <DataRow label="Running">{counts.RUNNING}</DataRow>
        <DataRow label="Failed">
          {counts.FAILED > 0 ? (
            <StateTag tone="alarm">{counts.FAILED}</StateTag>
          ) : (
            0
          )}
        </DataRow>
      </div>

      {failed.length > 0 && (
        <>
          <ul className="border border-dotted border-ink-20">
            {failed.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-dotted border-ink-20 px-3 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.8125rem] text-ink-80">
                    {TYPE_LABEL[job.type] ?? job.type}
                    <span className="text-ink-60">
                      {" "}
                      · {job.attempts} attempt{job.attempts === 1 ? "" : "s"} ·{" "}
                      {new Date(job.updatedAt).toLocaleString()}
                    </span>
                  </span>
                  <span className="block break-words text-[0.6875rem] leading-relaxed text-ink-60">
                    {job.lastError ?? "no error recorded"}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      act(`/api/admin/jobs/${job.id}`, job.id, {
                        action: "retry",
                      })
                    }
                  >
                    Retry
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      act(`/api/admin/jobs/${job.id}`, job.id, {
                        action: "discard",
                      })
                    }
                  >
                    Discard
                  </Button>
                </span>
              </li>
            ))}
          </ul>

          <div className="flex justify-end">
            <Button
              variant="default"
              size="sm"
              disabled={busy !== null}
              onClick={() => act("/api/admin/jobs", "all")}
            >
              {busy === "all" ? "…" : "Retry every failed job"}
            </Button>
          </div>
        </>
      )}

      <ErrorSlab>{error}</ErrorSlab>
      <Notice>{notice}</Notice>
    </div>
  );
}
