/**
 * How the vault's file list can be ordered.
 *
 * Shared by the page that queries and the control that chooses, so the two
 * cannot offer and accept different sets. Every order has a tiebreak on id, so
 * pages never overlap or skip a file when two share a name, a size, or a
 * timestamp.
 */

export const FILE_SORTS = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "name", label: "Name A–Z" },
  { id: "name-desc", label: "Name Z–A" },
  { id: "largest", label: "Largest" },
  { id: "smallest", label: "Smallest" },
] as const;

export type FileSort = (typeof FILE_SORTS)[number]["id"];

export function parseFileSort(raw: string | undefined): FileSort {
  return FILE_SORTS.some((option) => option.id === raw)
    ? (raw as FileSort)
    : "newest";
}

type Order = { [key: string]: "asc" | "desc" };

export function fileOrderBy(sort: FileSort): Order[] {
  switch (sort) {
    case "oldest":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "name":
      return [{ originalName: "asc" }, { id: "asc" }];
    case "name-desc":
      return [{ originalName: "desc" }, { id: "desc" }];
    case "largest":
      return [{ size: "desc" }, { id: "desc" }];
    case "smallest":
      return [{ size: "asc" }, { id: "asc" }];
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

export const FILES_PER_PAGE = 100;

/** A 1-based page from a query string, clamped to what exists. */
export function parsePage(raw: string | undefined, pageCount: number): number {
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1) return 1;
  return Math.min(page, Math.max(1, pageCount));
}
