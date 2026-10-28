"use client";

import { useDraggable } from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileIcon } from "@/components/file-icon";
import { FilePreview } from "@/components/file-preview";
import { RenameFileDialog } from "@/components/rename-file-dialog";
import { Button } from "@/components/ui/button";
import { IconDownload, IconTrash } from "@/components/world/icons";
import { StateTag } from "@/components/world/panel";
import { recallKey } from "@/lib/crypto/keyring";
import { downloadEncrypted } from "@/lib/crypto/save";
import { fileKindLabel } from "@/lib/file-kind";
import { formatBytes } from "@/lib/format";
import type { PreviewKind } from "@/lib/preview";
import type { ScanTag } from "@/lib/scan-tag";
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
  /** A THUMBNAIL job drew one for this file. */
  hasThumbnail?: boolean;
  /** How it can be previewed, if at all — decided by lib/preview.ts. */
  previewKind?: PreviewKind | null;
  /** The malware scanner's verdict, when one is configured. */
  scanStatus?: string | null;
  /** That verdict as a tag, worded for this instance's policy (lib/scan-tag.ts). */
  scan?: ScanTag | null;
  /** Its search index entry, when extraction has run: why it is not, or not wholly, searchable. */
  index?: { status: string; error: string | null } | null;
};

/**
 * A word about search, only when there is one to say: a file being indexed,
 * one that cannot be, or one only partly read. The reason goes in the title,
 * where it fits — "no extractor for application/x-foo", "OCR failed: …".
 */
function indexTag(index: FileRow["index"]) {
  if (!index) return null;

  if (index.status === "PENDING") {
    return { label: "Indexing", reason: index.error ?? "waiting its turn" };
  }
  if (index.status === "SKIPPED" || index.status === "FAILED") {
    return { label: "Not in search", reason: index.error ?? index.status };
  }
  if (index.status === "DONE" && index.error) {
    return { label: "Partly in search", reason: index.error };
  }

  return null;
}

/**
 * The file list: one row per file, separated by hairlines.
 *
 * Selection tints the row in the accent. Selection itself lives one level up
 * in VaultBrowser, because a share
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
      <div className="rounded-xl border border-dashed border-line-strong px-4 py-12 text-center">
        <p className="text-sm text-fg-subtle">Nothing stored here yet.</p>
        <p className="mt-1 text-[13px] text-fg-subtle">
          Upload a file above, or make a folder — then bundle either into a link
          with its own expiry and limits.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="border-t border-line">
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
        <output className="block text-[13px] leading-relaxed text-fg">
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
        "flex items-center gap-3 border-b border-line px-2 py-2.5 transition-colors",
        selected ? "bg-accent-soft" : "hover:bg-paper",
        drag.isDragging && "opacity-40",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(file.id)}
        aria-label={`Select ${file.originalName}`}
        className="size-4 shrink-0 accent-accent"
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
        className="shrink-0 cursor-grab rounded-md"
      >
        {file.hasThumbnail ? (
          // biome-ignore lint/performance/noImgElement: an owner-only guarded route, not an optimisable asset
          <img
            src={`/api/file/${file.id}/thumbnail`}
            alt=""
            loading="lazy"
            className="size-9 rounded-md object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
          />
        ) : (
          <FileIcon mimeType={file.mimeType} encrypted={file.isEncrypted} />
        )}
      </button>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-fg">
          {file.originalName}
          {file.ownerLabel && (
            <span className="font-normal text-fg-subtle">
              {" "}
              · {file.ownerLabel}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-fg-subtle">
          <span>{fileKindLabel(file.mimeType, file.originalName)}</span>
          <span className="sm:hidden">· {formatBytes(file.size)}</span>
          {file.isEncrypted && (
            <span className="text-e2e">· End-to-end encrypted</span>
          )}
          {(() => {
            const tag = indexTag(file.index);
            return tag ? (
              <span title={tag.reason}>· {tag.label.toLowerCase()}</span>
            ) : null;
          })()}
        </span>
      </span>

      {file.scan && (
        <span title={file.scan.reason} className="shrink-0">
          <StateTag tone={file.scan.tone}>{file.scan.label}</StateTag>
        </span>
      )}

      <span className="data hidden w-20 shrink-0 text-right text-fg-muted sm:block">
        {formatBytes(file.size)}
      </span>

      {confirming ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-[13px] text-fg">Move to trash?</span>
          <Button
            variant="danger-solid"
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
          {file.previewKind && (
            <FilePreview
              url={`/api/file/${file.id}/preview`}
              kind={file.previewKind}
              name={file.originalName}
            >
              <Button
                variant="ghost"
                size="sm"
                aria-label={`View ${file.originalName}`}
              >
                View
              </Button>
            </FilePreview>
          )}

          <RenameFileDialog file={file}>
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              aria-label={`Rename ${file.originalName}`}
            >
              Rename
            </Button>
          </RenameFileDialog>

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
