"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconDownload, IconFile, IconTrash } from "@/components/world/icons";
import { StateTag } from "@/components/world/panel";
import { formatBytes } from "@/lib/format";

export type AdminFileRow = {
  id: string;
  originalName: string;
  size: number;
  createdAt: string;
  ownerLabel: string;
  ownerRole: string;
  canDelete: boolean;
  /**
   * Only the owner may download a file — the owner route 404s for anyone
   * else, admins included, because "may delete" is not "may read". The
   * button is not offered where it could only fail.
   */
  canDownload: boolean;
};

export function AdminFiles({ files }: { files: AdminFileRow[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    const response = await fetch(`/api/file/${id}/delete`, { method: "POST" });
    const body = await response.json().catch(() => null);
    setBusy(null);
    setConfirming(null);

    setNote(
      response.ok
        ? `Deleted ${body?.deleted ?? "the file"}${
            body?.revokedShares
              ? `, revoking ${body.revokedShares} link(s)`
              : ""
          }.`
        : (body?.error ?? "Could not delete that file."),
    );

    router.refresh();
  }

  if (files.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[0.75rem] text-ink-60">
        No files to manage.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul>
        {files.map((file) => (
          <li
            key={file.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-dotted border-ink-20 py-2 last:border-b-0"
          >
            <IconFile className="size-4 shrink-0 text-ink-60" />

            <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-80">
              {file.originalName}
            </span>

            <span className="shrink-0 text-[0.6875rem] text-ink-60">
              {file.ownerLabel}
            </span>

            {file.ownerRole !== "user" && (
              <StateTag tone="quiet">{file.ownerRole}</StateTag>
            )}

            <span className="shrink-0 text-[0.6875rem] tabular-nums text-ink-60">
              {formatBytes(file.size)}
            </span>

            {confirming === file.id ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy === file.id}
                  onClick={() => remove(file.id)}
                >
                  {busy === file.id ? "…" : "Delete"}
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </Button>
              </span>
            ) : (
              <span className="flex shrink-0 items-center">
                {file.canDownload && (
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    aria-label={`Download ${file.originalName}`}
                  >
                    <a href={`/api/file/${file.id}`}>
                      <IconDownload className="size-4" />
                    </a>
                  </Button>
                )}

                {file.canDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${file.originalName}`}
                    onClick={() => setConfirming(file.id)}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>

      {note && (
        <output className="block text-[0.75rem] text-ink-90">{note}</output>
      )}
    </div>
  );
}
