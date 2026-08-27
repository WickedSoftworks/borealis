"use client";

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type FileRow, FileTable } from "@/components/file-table";
import { type Crumb, FolderBreadcrumb } from "@/components/folder-breadcrumb";
import { FolderDialog } from "@/components/folder-dialog";
import { FolderRow, type SubfolderRow } from "@/components/folder-row";
import { FolderTree, type FolderViewNode } from "@/components/folder-tree";
import { ShareDialog } from "@/components/share-dialog";
import { Button } from "@/components/ui/button";
import { IconPlus } from "@/components/world/icons";

/**
 * The vault, with folders.
 *
 * Owns three things that have to agree with each other: which folder you are
 * looking at, what is selected, and the drag in flight. Selection spans files
 * AND folders because a share can bundle either, and a drag moves whatever is
 * selected — so neither the tree nor the file list can own it alone.
 *
 * The tree is desktop-only and the breadcrumb is always present: on a phone the
 * breadcrumb is the whole navigation, and on a desktop it still answers "where
 * am I" faster than reading the highlight in the sidebar.
 */

type DragPayload = { kind: "file" | "folder"; id: string; label: string };

export function VaultBrowser({
  folders,
  crumbs,
  currentFolderId,
  subfolders,
  files,
}: {
  folders: FolderViewNode[];
  crumbs: Crumb[];
  currentFolderId: string | null;
  subfolders: SubfolderRow[];
  files: FileRow[];
}) {
  const router = useRouter();

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sensors = useSensors(
    // A few pixels of slop so a click on the handle stays a click. Without it
    // every attempt to focus the icon starts a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function navigate(id: string | null) {
    setSelectedFiles(new Set());
    setSelectedFolders(new Set());
    router.push(id === null ? "/dashboard" : `/dashboard?folder=${id}`);
  }

  function toggle(setter: typeof setSelectedFiles) {
    return (id: string) =>
      setter((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null);

    const payload = event.active.data.current as DragPayload | undefined;
    const target = event.over?.data.current as
      | { folderId: string | null }
      | undefined;

    if (!payload || !event.over || target === undefined) return;

    const destination = target.folderId;

    if (payload.kind === "folder") {
      // Dropping a folder on itself is a no-op, not an error worth a message.
      if (payload.id === destination) return;

      const response = await fetch(`/api/folders/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: destination }),
      });

      const body = await response.json().catch(() => null);

      setNotice(
        response.ok
          ? `Moved ${payload.label}.`
          : (body?.error ?? "Could not move that folder."),
      );

      router.refresh();
      return;
    }

    // Dragging one of several selected files moves the whole selection; that is
    // what the highlight promised. Dragging an unselected file moves only it.
    const fileIds = selectedFiles.has(payload.id)
      ? [...selectedFiles]
      : [payload.id];

    const response = await fetch("/api/files/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileIds, folderId: destination }),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setNotice(body?.error ?? "Could not move those files.");
      return;
    }

    const moved = `Moved ${body.moved} file${body.moved === 1 ? "" : "s"}.`;

    // Folder shares resolve live, so this is not a warning about something that
    // might happen later — those files are downloadable through that link now.
    setNotice(
      body.published > 0
        ? `${moved} That folder is inside ${body.published} live link${
            body.published === 1 ? "" : "s"
          }, so they can be downloaded through ${body.published === 1 ? "it" : "them"} now.`
        : moved,
    );

    setSelectedFiles(new Set());
    router.refresh();
  }

  async function deleteFolder(id: string) {
    setDeletingFolder(id);
    setNotice(null);

    const response = await fetch(`/api/folders/${id}/delete`, {
      method: "POST",
    });
    const body = await response.json().catch(() => null);

    setDeletingFolder(null);

    if (!response.ok) {
      setNotice(body?.error ?? "Could not delete that folder.");
      return;
    }

    const revoked =
      body.revokedShares > 0
        ? ` ${body.revokedShares} link${body.revokedShares === 1 ? "" : "s"} stopped working.`
        : "";

    setNotice(
      `Moved ${body.trashed} and ${body.files} file${
        body.files === 1 ? "" : "s"
      } to the trash.${revoked}`,
    );

    router.refresh();
  }

  const selectedCount = selectedFiles.size + selectedFolders.size;
  const everything = [
    ...subfolders.map((folder) => folder.id),
    ...files.map((file) => file.id),
  ];
  const allSelected =
    everything.length > 0 && selectedCount === everything.length;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event: DragStartEvent) =>
        setDragging(event.active.data.current as DragPayload)
      }
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="grid gap-4 lg:grid-cols-[15rem_1fr] lg:items-start">
        {/*
          Hidden rather than unmounted below lg so its droppables simply do not
          exist there — a drop target you cannot see is worse than none.
        */}
        <div className="hidden border border-dotted border-ink-20 py-1 lg:block">
          <FolderTree
            folders={folders}
            currentFolderId={currentFolderId}
            onOpen={navigate}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FolderBreadcrumb crumbs={crumbs} onOpen={navigate} />

            <FolderDialog parentId={currentFolderId}>
              <Button variant="quiet" size="sm">
                <IconPlus className="size-3.5" />
                New folder
              </Button>
            </FolderDialog>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2.5 text-[0.6875rem] uppercase tracking-[0.18em] text-ink-60">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => {
                  setSelectedFiles(
                    allSelected ? new Set() : new Set(files.map((f) => f.id)),
                  );
                  setSelectedFolders(
                    allSelected
                      ? new Set()
                      : new Set(subfolders.map((f) => f.id)),
                  );
                }}
                className="size-3.5 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100"
              />
              {selectedCount > 0 ? `${selectedCount} selected` : "Select all"}
            </label>

            <ShareDialog
              fileIds={[...selectedFiles]}
              folderIds={[...selectedFolders]}
              encryptedFileIds={files
                .filter(
                  (file) => file.isEncrypted && selectedFiles.has(file.id),
                )
                .map((file) => file.id)}
              disabled={selectedCount === 0}
            />
          </div>

          <FileTable
            files={files}
            selected={selectedFiles}
            onToggle={toggle(setSelectedFiles)}
            hasLeadingRows={subfolders.length > 0}
            leadingRows={subfolders.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                selected={selectedFolders.has(folder.id)}
                onToggle={toggle(setSelectedFolders)}
                onOpen={navigate}
                onDelete={deleteFolder}
                deleting={deletingFolder === folder.id}
              />
            ))}
          />

          {notice && (
            <output className="block text-[0.75rem] leading-relaxed text-ink-90">
              {notice}
            </output>
          )}
        </div>
      </div>

      {/*
        The overlay follows the pointer while the original row stays in place at
        reduced opacity, so the list never reflows mid-drag and the drop target
        under the cursor stays where the eye left it.
      */}
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <span className="border border-ink-100 bg-ground px-2 py-1 text-[0.75rem] text-ink-90">
            {selectedFiles.has(dragging.id) && selectedFiles.size > 1
              ? `${selectedFiles.size} files`
              : dragging.label}
          </span>
        )}
      </DragOverlay>
    </DndContext>
  );
}
