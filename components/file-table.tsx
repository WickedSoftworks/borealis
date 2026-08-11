"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShareDialog } from "@/components/share-dialog";
import { Button } from "@/components/ui/button";
import { IconDownload, IconFile, IconTrash } from "@/components/world/icons";
import { StateTag } from "@/components/world/panel";
import { recallKey } from "@/lib/crypto/keyring";
import { downloadEncrypted } from "@/lib/crypto/save";
import { formatBytes } from "@/lib/format";

export type FileRow = {
  id: string;
  originalName: string;
  size: number;
  createdAt: string;
  mimeType: string;
  isEncrypted: boolean;
  /** Owner's display name, shown only when browsing beyond your own files. */
  ownerLabel?: string | null;
  /** Server-computed; the client never decides who may delete what. */
  canDelete: boolean;
};

/**
 * The file grid.
 *
 * Selection is an inverted cell, matching how this world marks any active
 * thing. The share action is bound to the current selection rather than living
 * per-row, because a share is a bundle and that is the fact the UI should teach.
 */
export function FileTable({ files }: { files: FileRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState<string | null>(null);

  /**
   * Your own encrypted file is ciphertext to the server too, so fetching it
   * plainly would save an unreadable blob. The key comes from this browser's
   * keyring; if it isn't here, nothing can recover the file and saying so is
   * the only honest response.
   */
  async function fetchDecrypted(file: FileRow) {
    const key = recallKey(file.id);

    if (!key) {
      setError(
        `The key for ${file.originalName} is not in this browser. It was encrypted elsewhere, or this browser's site data was cleared — either way the file cannot be recovered here.`,
      );
      return;
    }

    setDecrypting(file.id);
    setError(null);

    try {
      await downloadEncrypted(
        `/api/file/${file.id}`,
        key,
        file.originalName,
        file.mimeType,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Could not decrypt ${file.originalName}: ${cause.message}`
          : `Could not decrypt ${file.originalName}.`,
      );
    } finally {
      setDecrypting(null);
    }
  }

  async function remove(id: string) {
    setDeleting(id);
    setError(null);

    const response = await fetch(`/api/file/${id}/delete`, { method: "POST" });
    const body = await response.json().catch(() => null);

    setDeleting(null);
    setConfirming(null);

    if (!response.ok) {
      setError(body?.error ?? "Could not delete that file.");
      return;
    }

    if (body?.revokedShares > 0) {
      setError(
        `Deleted. ${body.revokedShares} link${body.revokedShares === 1 ? "" : "s"} carrying it stopped working.`,
      );
    }

    setSelected((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });

    router.refresh();
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = files.length > 0 && selected.size === files.length;

  if (files.length === 0) {
    return (
      <div className="material-scan border border-dotted border-ink-20 px-4 py-12 text-center">
        <p className="text-[0.8125rem] text-ink-60">Nothing stored yet.</p>
        <p className="mt-1 text-[0.75rem] text-ink-60">
          Upload a file above, then bundle it into a link with its own expiry
          and limits.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2.5 text-[0.6875rem] uppercase tracking-[0.18em] text-ink-60">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() =>
              setSelected(
                allSelected ? new Set() : new Set(files.map((f) => f.id)),
              )
            }
            className="size-3.5 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100"
          />
          {selected.size > 0 ? `${selected.size} selected` : "Select all"}
        </label>

        <ShareDialog
          fileIds={[...selected]}
          encryptedFileIds={files
            .filter((file) => file.isEncrypted && selected.has(file.id))
            .map((file) => file.id)}
          disabled={selected.size === 0}
        />
      </div>

      <ul className="border border-dotted border-ink-20">
        {files.map((file) => {
          const isSelected = selected.has(file.id);

          return (
            <li
              key={file.id}
              className={
                isSelected
                  ? "flex items-center gap-3 border-b border-dotted border-ink-20 bg-ink-00 px-3 py-2 last:border-b-0"
                  : "flex items-center gap-3 border-b border-dotted border-ink-20 px-3 py-2 transition-colors last:border-b-0 hover:bg-ink-00/50"
              }
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggle(file.id)}
                aria-label={`Select ${file.originalName}`}
                className="size-3.5 shrink-0 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100"
              />

              <IconFile className="size-4 shrink-0 text-ink-60" />

              {/*
                Name and size stack below 640px: side by side on a phone the
                filename truncates to nothing while the size holds its width.
              */}
              <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span className="truncate text-[0.8125rem] text-ink-80">
                  {file.originalName}
                  {file.ownerLabel && (
                    <span className="text-ink-60"> · {file.ownerLabel}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[0.6875rem] tabular-nums text-ink-60">
                  {file.isEncrypted && (
                    <StateTag tone="quiet">Encrypted</StateTag>
                  )}
                  {formatBytes(file.size)}
                </span>
              </span>

              {confirming === file.id ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-ink-90">
                    Delete?
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={deleting === file.id}
                    onClick={() => remove(file.id)}
                  >
                    {deleting === file.id ? "…" : "Yes"}
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => setConfirming(null)}
                  >
                    No
                  </Button>
                </span>
              ) : (
                <span className="flex shrink-0 items-center">
                  {file.isEncrypted ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={decrypting === file.id}
                      aria-label={`Decrypt and download ${file.originalName}`}
                      onClick={() => fetchDecrypted(file)}
                    >
                      <IconDownload className="size-4" />
                    </Button>
                  ) : (
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

                  {/*
                    The button only renders when the server said this actor may
                    delete this file. The endpoint re-checks regardless — this
                    is presentation, never the control.
                  */}
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
          );
        })}
      </ul>

      {/* <output> is the live region for this; role="status" on a <p> is not. */}
      {(decrypting || error) && (
        <output className="block text-[0.75rem] leading-relaxed text-ink-90">
          {decrypting ? "Decrypting in this browser…" : error}
        </output>
      )}
    </div>
  );
}
