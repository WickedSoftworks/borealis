"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconFile } from "@/components/world/icons";
import { StateTag } from "@/components/world/panel";
import { formatBytes, formatRemaining } from "@/lib/format";

export type TrashRow = {
  id: string;
  originalName: string;
  size: number;
  isEncrypted: boolean;
  /** ISO. When the bytes go, computed server-side from the retention window. */
  purgeAt: string;
};

/**
 * The trash.
 *
 * Every row states its own deadline rather than the panel stating one for all
 * of them, because the window is per-file and an operator deciding what to
 * rescue needs to know which one goes first. "Empty trash" confirms in place,
 * the same way a per-file delete does — it is the more destructive of the two
 * and must not be the easier one.
 */
export function TrashTable({ files }: { files: TrashRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function restore(file: TrashRow) {
    setBusy(file.id);
    setNote(null);

    const response = await fetch(`/api/file/${file.id}/restore`, {
      method: "POST",
    });
    const body = await response.json().catch(() => null);

    setBusy(null);

    if (!response.ok) {
      setNote(body?.error ?? `Could not restore ${file.originalName}.`);
      return;
    }

    // Said plainly, because the links are the part people assume comes back.
    setNote(
      `Restored ${file.originalName}. Links that carried it stay revoked — share it again to hand it out.`,
    );
    router.refresh();
  }

  async function empty() {
    setBusy("all");
    setNote(null);

    const response = await fetch("/api/trash/empty", { method: "POST" });
    const body = await response.json().catch(() => null);

    setBusy(null);
    setConfirmingEmpty(false);

    if (!response.ok) {
      setNote(body?.error ?? "Could not empty the trash.");
      return;
    }

    const purged = body?.purged ?? 0;
    const failed = body?.failed ?? 0;

    setNote(
      failed > 0
        ? `Removed ${purged} file${purged === 1 ? "" : "s"}. ${failed} could not be reached in storage and stayed in the trash — the sweep will try again.`
        : `Removed ${purged} file${purged === 1 ? "" : "s"} for good.`,
    );
    router.refresh();
  }

  if (files.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[0.75rem] text-ink-60">
        The trash is empty.
      </p>
    );
  }

  const trashedBytes = files.reduce((total, file) => total + file.size, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.6875rem] uppercase tracking-[0.18em] text-ink-60">
          {files.length} file{files.length === 1 ? "" : "s"} ·{" "}
          {formatBytes(trashedBytes)} still on disk
        </p>

        {confirmingEmpty ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-ink-90">
              Remove all, for good?
            </span>
            <Button
              variant="primary"
              size="sm"
              disabled={busy === "all"}
              onClick={empty}
            >
              {busy === "all" ? "…" : "Yes"}
            </Button>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => setConfirmingEmpty(false)}
            >
              No
            </Button>
          </span>
        ) : (
          <Button
            variant="quiet"
            size="sm"
            onClick={() => setConfirmingEmpty(true)}
          >
            Empty trash
          </Button>
        )}
      </div>

      <ul className="border border-dotted border-ink-20">
        {files.map((file) => {
          const remaining = formatRemaining(file.purgeAt);
          // Past due and the sweep has not come round yet — hourly, so this is
          // a real state a person can see rather than a rounding artefact.
          const deadline =
            remaining === null || remaining === "expired"
              ? "removing shortly"
              : `${remaining} to restore`;

          return (
            <li
              key={file.id}
              className="flex items-center gap-3 border-b border-dotted border-ink-20 px-3 py-2 transition-colors last:border-b-0 hover:bg-ink-00/50"
            >
              <IconFile className="size-4 shrink-0 text-ink-40" />

              <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span className="truncate text-[0.8125rem] text-ink-60">
                  {file.originalName}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[0.6875rem] tabular-nums text-ink-60">
                  {file.isEncrypted && (
                    <StateTag tone="quiet">Encrypted</StateTag>
                  )}
                  <StateTag tone="quiet">{deadline}</StateTag>
                  {formatBytes(file.size)}
                </span>
              </span>

              <Button
                variant="quiet"
                size="sm"
                className="shrink-0"
                disabled={busy === file.id}
                aria-label={`Restore ${file.originalName}`}
                onClick={() => restore(file)}
              >
                {busy === file.id ? "…" : "Restore"}
              </Button>
            </li>
          );
        })}
      </ul>

      {note && (
        <output className="block text-[0.75rem] leading-relaxed text-ink-90">
          {note}
        </output>
      )}
    </div>
  );
}
