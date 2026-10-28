"use client";

import { useDroppable } from "@dnd-kit/core";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

/**
 * Where you are, and the way back out.
 *
 * Each segment is a drop target as well as a link, which is how moving a file
 * *up* the tree works on a narrow screen: there is no sidebar to drag to, but
 * the ancestors are all right there in the trail.
 */

export type Crumb = { id: string | null; name: string };

function Segment({
  crumb,
  isLast,
  onOpen,
}: {
  crumb: Crumb;
  isLast: boolean;
  onOpen: (id: string | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `crumb:${crumb.id ?? "root"}`,
    data: { folderId: crumb.id },
  });

  return (
    <li ref={setNodeRef} className="flex min-w-0 items-center">
      <button
        type="button"
        onClick={() => onOpen(crumb.id)}
        aria-current={isLast ? "page" : undefined}
        className={cn(
          "max-w-[12rem] truncate px-1.5 py-0.5 transition-colors",
          isLast ? "text-fg" : "text-fg-subtle hover:text-fg",
          isOver && "outline outline-1 outline-accent bg-raised text-fg",
        )}
      >
        {crumb.name}
      </button>
    </li>
  );
}

export function FolderBreadcrumb({
  crumbs,
  onOpen,
}: {
  crumbs: Crumb[];
  onOpen: (id: string | null) => void;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center text-[13px]">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.id ?? "root"}>
            {index > 0 && (
              <li aria-hidden className="text-fg-subtle">
                /
              </li>
            )}
            <Segment
              crumb={crumb}
              isLast={index === crumbs.length - 1}
              onOpen={onOpen}
            />
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
