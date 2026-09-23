"use client";

import type { FolderViewNode } from "@/components/folder-tree";
import { IconFile, IconFolder, IconLock } from "@/components/world/icons";
import { formatBytes } from "@/lib/format";

export type PickerFile = {
  id: string;
  originalName: string;
  folderId: string | null;
  isEncrypted: boolean;
  size: number;
};

const CHECKBOX =
  "size-3.5 shrink-0 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100 disabled:border-ink-20";

/** Every folder reachable from a selected one, since a shared folder carries its subtree. */
function coveredFolderIds(
  folders: FolderViewNode[],
  selected: Set<string>,
): Set<string> {
  const covered = new Set<string>();

  const walk = (nodes: FolderViewNode[], inherited: boolean) => {
    for (const node of nodes) {
      const inside = inherited || selected.has(node.id);
      if (inside) covered.add(node.id);
      walk(node.children, inside);
    }
  };

  walk(folders, false);

  return covered;
}

/**
 * What a link carries, as a checkable tree.
 *
 * `VaultBrowser` cannot be reused here: it is fed one folder at a time by the
 * dashboard's server component and navigates by pushing `?folder=`, neither of
 * which works inside a dialog. This takes the whole tree at once instead.
 *
 * Files inside a selected folder are shown checked and disabled rather than
 * hidden. A folder share resolves live (lib/shares/contents.ts), so those files
 * really are carried, and ticking them individually as well would only add
 * ShareItem rows that change nothing.
 */
export function ShareItemPicker({
  files,
  folders,
  selectedFiles,
  selectedFolders,
  onToggleFile,
  onToggleFolder,
}: {
  files: PickerFile[];
  folders: FolderViewNode[];
  selectedFiles: Set<string>;
  selectedFolders: Set<string>;
  onToggleFile: (id: string) => void;
  onToggleFolder: (id: string) => void;
}) {
  const covered = coveredFolderIds(folders, selectedFolders);

  const filesIn = (folderId: string | null) =>
    files.filter((file) => file.folderId === folderId);

  const fileRow = (file: PickerFile) => {
    const viaFolder = file.folderId !== null && covered.has(file.folderId);

    return (
      <li key={file.id}>
        <label
          className={`flex items-center gap-2 py-0.5 text-[0.75rem] ${
            viaFolder ? "text-ink-40" : "text-ink-80"
          }`}
        >
          <input
            type="checkbox"
            checked={viaFolder || selectedFiles.has(file.id)}
            disabled={viaFolder}
            onChange={() => onToggleFile(file.id)}
            className={CHECKBOX}
          />
          <IconFile className="size-3 shrink-0" />
          <span className="truncate">{file.originalName}</span>
          {file.isEncrypted && (
            <IconLock
              className="size-3 shrink-0"
              aria-label="Encrypted in the browser"
            />
          )}
          <span className="ml-auto shrink-0 pl-2 text-[0.6875rem] text-ink-40">
            {viaFolder ? "in folder" : formatBytes(file.size)}
          </span>
        </label>
      </li>
    );
  };

  const folderRow = (node: FolderViewNode) => {
    const inherited = covered.has(node.id) && !selectedFolders.has(node.id);

    return (
      <li key={node.id}>
        <label
          className={`flex items-center gap-2 py-0.5 text-[0.75rem] ${
            inherited ? "text-ink-40" : "text-ink-80"
          }`}
        >
          <input
            type="checkbox"
            checked={covered.has(node.id)}
            disabled={inherited}
            onChange={() => onToggleFolder(node.id)}
            className={CHECKBOX}
          />
          <IconFolder className="size-3 shrink-0" />
          <span className="truncate">{node.name}</span>
        </label>

        <ul className="ml-4 border-l border-dotted border-ink-20 pl-2">
          {node.children.map(folderRow)}
          {filesIn(node.id).map(fileRow)}
        </ul>
      </li>
    );
  };

  const loose = filesIn(null);

  if (folders.length === 0 && files.length === 0) {
    return (
      <p className="py-3 text-[0.75rem] text-ink-60">
        Nothing to share yet — upload a file first.
      </p>
    );
  }

  return (
    <div className="max-h-56 overflow-y-auto border border-dotted border-ink-20 p-2">
      <ul>
        {folders.map(folderRow)}
        {loose.map(fileRow)}
      </ul>
    </div>
  );
}
