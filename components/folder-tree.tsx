"use client";

import { useDroppable } from "@dnd-kit/core";
import { useState } from "react";
import { IconFolder } from "@/components/world/icons";
import { cn } from "@/lib/utils";

/**
 * The vault's shape, at desktop widths.
 *
 * Every node is a drop target, which is the reason this exists at all: the
 * breadcrumb can navigate perfectly well, but you cannot drag a file to a
 * folder you cannot see. Source and destination visible at once is the whole
 * argument for a sidebar.
 */

export type FolderViewNode = {
  id: string;
  name: string;
  parentId: string | null;
  children: FolderViewNode[];
};

/** Ancestors of `id`, so the tree opens to wherever the user already is. */
function ancestorsOf(nodes: FolderViewNode[], id: string | null): string[] {
  if (id === null) return [];

  const trail: string[] = [];

  const walk = (list: FolderViewNode[], path: string[]): boolean => {
    for (const node of list) {
      const next = [...path, node.id];

      if (node.id === id) {
        trail.push(...path);
        return true;
      }

      if (walk(node.children, next)) return true;
    }

    return false;
  };

  walk(nodes, []);

  return trail;
}

function Node({
  node,
  depth,
  currentId,
  expanded,
  onExpand,
  onOpen,
}: {
  node: FolderViewNode;
  depth: number;
  currentId: string | null;
  expanded: Set<string>;
  onExpand: (id: string) => void;
  onOpen: (id: string | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder:${node.id}`,
    data: { folderId: node.id },
  });

  const isOpen = expanded.has(node.id);
  const isCurrent = currentId === node.id;
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div
        ref={setNodeRef}
        style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}
        className={cn(
          "flex items-center gap-1.5 py-1 pr-2 transition-colors",
          isCurrent && "bg-ink-00",
          // The drop target has to read at a glance mid-drag, when the pointer
          // is moving and the cursor is covering part of the row.
          isOver && "outline outline-1 outline-ink-100 bg-ink-00",
        )}
      >
        {/*
          The twisty is its own control, separate from the name. Clicking a
          folder should go into it; expanding is a different intent and
          collapsing one to reach a sibling should not navigate away.
        */}
        <button
          type="button"
          onClick={() => onExpand(node.id)}
          aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
          aria-expanded={hasChildren ? isOpen : undefined}
          disabled={!hasChildren}
          className="flex size-4 shrink-0 items-center justify-center text-[0.625rem] text-ink-60 disabled:opacity-0"
        >
          {isOpen ? "▾" : "▸"}
        </button>

        <button
          type="button"
          onClick={() => onOpen(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <IconFolder className="size-3.5 shrink-0 text-ink-60" />
          <span
            className={cn(
              "truncate text-[0.75rem]",
              isCurrent ? "text-ink-90" : "text-ink-80",
            )}
          >
            {node.name}
          </span>
        </button>
      </div>

      {isOpen && hasChildren && (
        <ul>
          {node.children.map((child) => (
            <Node
              key={child.id}
              node={child}
              depth={depth + 1}
              currentId={currentId}
              expanded={expanded}
              onExpand={onExpand}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FolderTree({
  folders,
  currentFolderId,
  onOpen,
}: {
  folders: FolderViewNode[];
  currentFolderId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(ancestorsOf(folders, currentFolderId)),
  );

  const root = useDroppable({ id: "folder:root", data: { folderId: null } });

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <nav aria-label="Folders" className="text-[0.75rem]">
      <div
        ref={root.setNodeRef}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 transition-colors",
          currentFolderId === null && "bg-ink-00",
          root.isOver && "outline outline-1 outline-ink-100 bg-ink-00",
        )}
      >
        <button
          type="button"
          onClick={() => onOpen(null)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left uppercase tracking-[0.18em] text-ink-60"
        >
          Vault
        </button>
      </div>

      {folders.length === 0 ? (
        <p className="px-2 py-2 text-[0.6875rem] leading-relaxed text-ink-60">
          No folders yet.
        </p>
      ) : (
        <ul>
          {folders.map((node) => (
            <Node
              key={node.id}
              node={node}
              depth={0}
              currentId={currentFolderId}
              expanded={expanded}
              onExpand={toggle}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}
