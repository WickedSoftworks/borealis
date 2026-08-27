"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useState } from "react";
import { FolderDialog } from "@/components/folder-dialog";
import { Button } from "@/components/ui/button";
import { IconFolder, IconTrash } from "@/components/world/icons";
import { cn } from "@/lib/utils";

export type SubfolderRow = {
  id: string;
  name: string;
  fileCount: number;
  folderCount: number;
};

/**
 * A subfolder, in the file list.
 *
 * Both a drag source and a drop target: you can drag a folder into another
 * folder, and drop files onto it. dnd-kit is fine with one node being both, but
 * the two hooks need separate refs merged onto the same element.
 */
export function FolderRow({
  folder,
  selected,
  onToggle,
  onOpen,
  onDelete,
  deleting,
}: {
  folder: SubfolderRow;
  selected: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  const drag = useDraggable({
    id: `folder:${folder.id}`,
    data: { kind: "folder" as const, id: folder.id, label: folder.name },
  });

  const drop = useDroppable({
    id: `row:${folder.id}`,
    data: { folderId: folder.id },
  });

  const contents = [
    folder.folderCount > 0 &&
      `${folder.folderCount} folder${folder.folderCount === 1 ? "" : "s"}`,
    `${folder.fileCount} file${folder.fileCount === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li
      ref={drop.setNodeRef}
      className={cn(
        "flex items-center gap-3 border-b border-dotted border-ink-20 px-3 py-2 transition-colors last:border-b-0",
        selected ? "bg-ink-00" : "hover:bg-ink-00/50",
        drop.isOver && "outline outline-1 outline-ink-100 bg-ink-00",
        drag.isDragging && "opacity-40",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(folder.id)}
        aria-label={`Select ${folder.name}`}
        className="size-3.5 shrink-0 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100"
      />

      {/*
        The drag handle is the icon, not the whole row. A row-wide handle would
        swallow the click that opens the folder, and dnd-kit's keyboard sensor
        needs a focusable element to start a move from.
      */}
      <button
        type="button"
        ref={drag.setNodeRef}
        {...drag.listeners}
        {...drag.attributes}
        aria-label={`Move ${folder.name}`}
        className="shrink-0 cursor-grab text-ink-60 hover:text-ink-100"
      >
        <IconFolder className="size-4" />
      </button>

      <button
        type="button"
        onClick={() => onOpen(folder.id)}
        className="flex min-w-0 flex-1 flex-col text-left sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
      >
        <span className="truncate text-[0.8125rem] text-ink-90">
          {folder.name}
        </span>
        <span className="shrink-0 text-[0.6875rem] tabular-nums text-ink-60">
          {contents}
        </span>
      </button>

      {confirming ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-ink-90">
            {folder.fileCount > 0 || folder.folderCount > 0
              ? "Trash all?"
              : "Delete?"}
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={deleting}
            onClick={() => onDelete(folder.id)}
          >
            {deleting ? "…" : "Yes"}
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
        <span className="flex shrink-0 items-center">
          <FolderDialog folder={folder}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Rename ${folder.name}`}
            >
              Rename
            </Button>
          </FolderDialog>

          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${folder.name}`}
            onClick={() => setConfirming(true)}
          >
            <IconTrash className="size-4" />
          </Button>
        </span>
      )}
    </li>
  );
}
