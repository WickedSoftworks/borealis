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
        "flex items-center gap-3 border-b border-line px-2 py-2.5 transition-colors",
        selected ? "bg-accent-soft" : "hover:bg-paper",
        drop.isOver &&
          "bg-accent-soft outline outline-1 -outline-offset-1 outline-accent",
        drag.isDragging && "opacity-40",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(folder.id)}
        aria-label={`Select ${folder.name}`}
        className="size-4 shrink-0 accent-accent"
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
        className="grid size-9 shrink-0 cursor-grab place-items-center rounded-md bg-raised text-fg-muted"
      >
        <IconFolder className="size-[18px]" />
      </button>

      <button
        type="button"
        onClick={() => onOpen(folder.id)}
        className="flex min-w-0 flex-1 flex-col rounded-sm text-left hover:text-accent"
      >
        <span className="truncate text-sm font-medium">{folder.name}</span>
        <span className="text-[13px] text-fg-subtle">
          Folder{contents ? ` · ${contents}` : ""}
        </span>
      </button>

      {confirming ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-[13px] text-fg">
            {folder.fileCount > 0 || folder.folderCount > 0
              ? "Trash all?"
              : "Delete?"}
          </span>
          <Button
            variant="danger-solid"
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
