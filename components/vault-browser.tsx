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
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { type FileRow, FileTable } from "@/components/file-table";
import { type Crumb, FolderBreadcrumb } from "@/components/folder-breadcrumb";
import { FolderDialog } from "@/components/folder-dialog";
import { FolderRow, type SubfolderRow } from "@/components/folder-row";
import { FolderTree, type FolderViewNode } from "@/components/folder-tree";
import { ShareDialog } from "@/components/share-dialog";
import type { ShareFormContext } from "@/components/share-fields";
import { Button } from "@/components/ui/button";
import { IconDownload, IconPlus, IconTrash } from "@/components/world/icons";
import { FILE_SORTS, type FileSort } from "@/lib/file-sort";

/**
 * The vault, with folders.
 *
 * Owns three things that have to agree with each other: which folder you are
 * looking at, what is selected, and the drag in flight. Selection spans files
 * AND folders because a share can bundle either, and a drag moves whatever is
 * selected — so neither the tree nor the file list can own it alone.
 *
 * Everything a selection can do sits in one bar: share, download as one
 * archive, move, delete. Before, the only thing a multi-select could do was
 * make a link.
 *
 * The tree is desktop-only and the breadcrumb is always present: on a phone the
 * breadcrumb is the whole navigation, and on a desktop it still answers "where
 * am I" faster than reading the highlight in the sidebar.
 */

type DragPayload = { kind: "file" | "folder"; id: string; label: string };

export type Pagination = {
  page: number;
  pageCount: number;
  total: number;
  sort: FileSort;
};

/** Every folder, flattened with its path, for the "Move to" list. */
function flatten(
  nodes: FolderViewNode[],
  prefix = "",
): Array<{ id: string; path: string }> {
  return nodes.flatMap((node) => [
    { id: node.id, path: `${prefix}${node.name}` },
    ...flatten(node.children, `${prefix}${node.name} / `),
  ]);
}

export function VaultBrowser({
  folders,
  crumbs,
  currentFolderId,
  subfolders,
  files,
  pagination,
  context,
}: {
  folders: FolderViewNode[];
  crumbs: Crumb[];
  currentFolderId: string | null;
  subfolders: SubfolderRow[];
  files: FileRow[];
  pagination: Pagination;
  context: ShareFormContext;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const archiveForm = useRef<HTMLFormElement>(null);

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");

  const sensors = useSensors(
    // A few pixels of slop so a click on the handle stays a click. Without it
    // every attempt to focus the icon starts a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function clearSelection() {
    setSelectedFiles(new Set());
    setSelectedFolders(new Set());
    setConfirmingDelete(false);
  }

  /** Change one query parameter, keeping the others (folder, sort, page). */
  function withParam(name: string, value: string | null, resetPage = true) {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(name);
    else next.set(name, value);
    if (resetPage && name !== "page") next.delete("page");
    const query = next.toString();
    return query ? `/dashboard?${query}` : "/dashboard";
  }

  function navigate(id: string | null) {
    clearSelection();
    const next = new URLSearchParams();
    if (id !== null) next.set("folder", id);
    const sort = params.get("sort");
    if (sort) next.set("sort", sort);
    const query = next.toString();
    router.push(query ? `/dashboard?${query}` : "/dashboard");
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

  async function moveFiles(fileIds: string[], destination: string | null) {
    const response = await fetch("/api/files/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileIds, folderId: destination }),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setNotice(body?.error ?? "Could not move those files.");
      return false;
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

    return true;
  }

  async function moveFolder(
    id: string,
    label: string,
    destination: string | null,
  ) {
    const response = await fetch(`/api/folders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: destination }),
    });

    const body = await response.json().catch(() => null);

    setNotice(
      response.ok
        ? `Moved ${label}.`
        : (body?.error ?? "Could not move that folder."),
    );

    return response.ok;
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
      await moveFolder(payload.id, payload.label, destination);
      router.refresh();
      return;
    }

    // Dragging one of several selected files moves the whole selection; that is
    // what the highlight promised. Dragging an unselected file moves only it.
    const fileIds = selectedFiles.has(payload.id)
      ? [...selectedFiles]
      : [payload.id];

    if (await moveFiles(fileIds, destination)) {
      setSelectedFiles(new Set());
      router.refresh();
    }
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

  async function bulkMove() {
    if (moveTarget === "") return;

    const destination = moveTarget === "root" ? null : moveTarget;
    setBusy(true);
    setNotice(null);

    if (selectedFiles.size > 0)
      await moveFiles([...selectedFiles], destination);

    for (const id of selectedFolders) {
      if (id === destination) continue;
      const label =
        subfolders.find((folder) => folder.id === id)?.name ?? "folder";
      await moveFolder(id, label, destination);
    }

    setBusy(false);
    setMoveTarget("");
    clearSelection();
    router.refresh();
  }

  async function bulkDelete() {
    setBusy(true);
    setNotice(null);

    let trashedFiles = 0;
    let revoked = 0;

    if (selectedFiles.size > 0) {
      const response = await fetch("/api/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: [...selectedFiles] }),
      });
      const body = await response.json().catch(() => null);

      if (response.ok) {
        trashedFiles += body.trashed;
        revoked += body.revokedShares;
      }
    }

    let trashedFolders = 0;

    for (const id of selectedFolders) {
      const response = await fetch(`/api/folders/${id}/delete`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);

      if (response.ok) {
        trashedFolders++;
        trashedFiles += body.files;
        revoked += body.revokedShares;
      }
    }

    setBusy(false);
    clearSelection();

    const parts = [
      trashedFolders > 0 &&
        `${trashedFolders} folder${trashedFolders === 1 ? "" : "s"}`,
      `${trashedFiles} file${trashedFiles === 1 ? "" : "s"}`,
    ].filter(Boolean);

    setNotice(
      `Moved ${parts.join(" and ")} to the trash.${
        revoked > 0
          ? ` ${revoked} link${revoked === 1 ? "" : "s"} stopped working.`
          : ""
      }`,
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
  const moveOptions = flatten(folders).filter(
    (option) => !selectedFolders.has(option.id),
  );

  return (
    <DndContext
      // A fixed id: dnd-kit otherwise numbers its accessibility ids from a
      // module counter, which differs between the server render and the
      // browser's and fails hydration.
      id="vault-dnd"
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

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.16em] text-ink-60">
                Sort
                <select
                  value={pagination.sort}
                  onChange={(event) =>
                    router.push(
                      withParam(
                        "sort",
                        event.target.value === "newest"
                          ? null
                          : event.target.value,
                      ),
                    )
                  }
                  className="h-7 border border-dotted border-ink-40 bg-ground px-1.5 font-mono text-[0.6875rem] normal-case tracking-normal text-ink-90 outline-none focus-visible:border-solid focus-visible:border-ink-100"
                >
                  {FILE_SORTS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <FolderDialog parentId={currentFolderId}>
                <Button variant="quiet" size="sm">
                  <IconPlus className="size-3.5" />
                  New folder
                </Button>
              </FolderDialog>
            </div>
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
                  setConfirmingDelete(false);
                }}
                className="size-3.5 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100"
              />
              {selectedCount > 0 ? `${selectedCount} selected` : "Select all"}
            </label>

            <div className="flex flex-wrap items-center gap-1.5">
              {selectedCount > 0 && (
                <>
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={busy}
                    onClick={() => archiveForm.current?.submit()}
                  >
                    <IconDownload className="size-3.5" />
                    Download
                  </Button>

                  <span className="flex items-center gap-1">
                    <select
                      aria-label="Move the selection to"
                      value={moveTarget}
                      onChange={(event) => setMoveTarget(event.target.value)}
                      className="h-7 max-w-40 border border-dotted border-ink-40 bg-ground px-1.5 font-mono text-[0.6875rem] text-ink-90 outline-none focus-visible:border-solid focus-visible:border-ink-100"
                    >
                      <option value="">Move to…</option>
                      {currentFolderId !== null && (
                        <option value="root">Vault (top level)</option>
                      )}
                      {moveOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.path}
                        </option>
                      ))}
                    </select>
                    {moveTarget !== "" && (
                      <Button
                        variant="default"
                        size="sm"
                        disabled={busy}
                        onClick={bulkMove}
                      >
                        Move
                      </Button>
                    )}
                  </span>

                  {confirmingDelete ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-ink-90">
                        Trash {selectedCount}?
                      </span>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={bulkDelete}
                      >
                        {busy ? "…" : "Yes"}
                      </Button>
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => setConfirmingDelete(false)}
                      >
                        No
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmingDelete(true)}
                    >
                      <IconTrash className="size-3.5" />
                      Delete
                    </Button>
                  )}
                </>
              )}

              <ShareDialog
                fileIds={[...selectedFiles]}
                folderIds={[...selectedFolders]}
                encryptedFileIds={files
                  .filter(
                    (file) => file.isEncrypted && selectedFiles.has(file.id),
                  )
                  .map((file) => file.id)}
                disabled={selectedCount === 0}
                context={context}
              />
            </div>
          </div>

          {/*
            The archive is fetched by a real form submission, not by fetch(),
            so the browser streams it to disk as a download instead of holding
            the whole thing in memory as a blob first.
          */}
          <form
            ref={archiveForm}
            method="post"
            action="/api/files/archive"
            className="hidden"
          >
            {[...selectedFiles].map((id) => (
              <input key={id} type="hidden" name="fileId" value={id} />
            ))}
            {[...selectedFolders].map((id) => (
              <input key={id} type="hidden" name="folderId" value={id} />
            ))}
          </form>

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

          {pagination.pageCount > 1 && (
            <nav
              aria-label="Pages"
              className="flex items-center justify-between gap-3 text-[0.6875rem] text-ink-60"
            >
              <Button
                variant="quiet"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() => {
                  clearSelection();
                  router.push(
                    withParam(
                      "page",
                      pagination.page - 1 <= 1
                        ? null
                        : String(pagination.page - 1),
                      false,
                    ),
                  );
                }}
              >
                Previous
              </Button>
              <span className="tabular-nums">
                Page {pagination.page} of {pagination.pageCount} ·{" "}
                {pagination.total} file{pagination.total === 1 ? "" : "s"} here
              </span>
              <Button
                variant="quiet"
                size="sm"
                disabled={pagination.page >= pagination.pageCount}
                onClick={() => {
                  clearSelection();
                  router.push(
                    withParam("page", String(pagination.page + 1), false),
                  );
                }}
              >
                Next
              </Button>
            </nav>
          )}

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
