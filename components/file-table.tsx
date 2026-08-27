"use client";

import { useDraggable } from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconDownload, IconFile, IconTrash } from "@/components/world/icons";
import { StateTag } from "@/components/world/panel";
import { recallKey } from "@/lib/crypto/keyring";
import { downloadEncrypted } from "@/lib/crypto/save";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

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
 * thing. Selection itself lives one level up in VaultBrowser, because a share
 * can now bundle folders as well as files and a drag moves whatever is
 * selected — both of which need to see the same set this list is drawing.
 */
export function FileTable({
  files,
  selected,
  onToggle,
  leadingRows,
  hasLeadingRows = false,
}: {
  files: FileRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** Subfolder rows, drawn inside the same enclosure above the files. */
  leadingRows?: React.ReactNode;
  hasLeadingRows?: boolean;
}) {
  const router = useRouter();
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

    router.refresh();
  }

  if (files.length === 0 && !hasLeadingRows) {
    return (
      <div className="material-scan border border-dotted border-ink-20 px-4 py-12 text-center">
        <p className="text-[0.8125rem] text-ink-60">Nothing stored here yet.</p>
        <p className="mt-1 text-[0.75rem] text-ink-60">
          Upload a file above, or make a folder — then bundle either into a link
          with its own expiry and limits.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="border border-dotted border-ink-20">
        {leadingRows}

        {files.map((file) => (
          <Row
            key={file.id}
            file={file}
            selected={selected.has(file.id)}
            onToggle={onToggle}
            confirming={confirming === file.id}
            onConfirm={setConfirming}
            deleting={deleting === file.id}
            onDelete={remove}
            decrypting={decrypting === file.id}
            onDecrypt={fetchDecrypted}
          />
        ))}
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

function Row({
  file,
  selected,
  onToggle,
  confirming,
  onConfirm,
  deleting,
  onDelete,
  decrypting,
  onDecrypt,
}: {
  file: FileRow;
  selected: boolean;
  onToggle: (id: string) => void;
  confirming: boolean;
  onConfirm: (id: string | null) => void;
  deleting: boolean;
  onDelete: (id: string) => void;
  decrypting: boolean;
  onDecrypt: (file: FileRow) => void;
}) {
  const drag = useDraggable({
    id: `file:${file.id}`,
    data: { kind: "file" as const, id: file.id, label: file.originalName },
  });

  return (
    <li
      className={cn(
        "flex items-center gap-3 border-b border-dotted border-ink-20 px-3 py-2 transition-colors last:border-b-0",
        selected ? "bg-ink-00" : "hover:bg-ink-00/50",
        drag.isDragging && "opacity-40",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(file.id)}
        aria-label={`Select ${file.originalName}`}
        className="size-3.5 shrink-0 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100"
      />

      {/*
        The icon is the drag handle. Making the whole row draggable would fight
        the checkbox and the buttons, and the keyboard sensor needs a focusable
        element to begin a move from.
      */}
      <button
        type="button"
        ref={drag.setNodeRef}
        {...drag.listeners}
        {...drag.attributes}
        aria-label={`Move ${file.originalName}`}
        className="shrink-0 cursor-grab text-ink-60 hover:text-ink-100"
      >
        <IconFile className="size-4" />
      </button>

      {/*
        Name and size stack below 640px: side by side on a phone the filename
        truncates to nothing while the size holds its width.
      */}
      <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <span className="truncate text-[0.8125rem] text-ink-80">
          {file.originalName}
          {file.ownerLabel && (
            <span className="text-ink-60"> · {file.ownerLabel}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[0.6875rem] tabular-nums text-ink-60">
          {file.isEncrypted && <StateTag tone="quiet">Encrypted</StateTag>}
          {formatBytes(file.size)}
        </span>
      </span>

      {confirming ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-ink-90">
            Delete?
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={deleting}
            onClick={() => onDelete(file.id)}
          >
            {deleting ? "…" : "Yes"}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => onConfirm(null)}>
            No
          </Button>
        </span>
      ) : (
        <span className="flex shrink-0 items-center">
          {file.isEncrypted ? (
            <Button
              variant="ghost"
              size="icon"
              disabled={decrypting}
              aria-label={`Decrypt and download ${file.originalName}`}
              onClick={() => onDecrypt(file)}
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
            The button only renders when the server said this actor may delete
            this file. The endpoint re-checks regardless — this is
            presentation, never the control.
          */}
          {file.canDelete && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${file.originalName}`}
              onClick={() => onConfirm(file.id)}
            >
              <IconTrash className="size-4" />
            </Button>
          )}
        </span>
      )}
    </li>
  );
}
