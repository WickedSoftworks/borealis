/**
 * What a search asks for, parsed from a query string.
 *
 * Pure, and shared by the route and the tests. Every parameter is optional
 * and every bad value is dropped rather than refused — a search box that
 * errors because a date field held "2026-13-45" is worse than one that
 * ignores it — except the text itself, which must be long enough to be worth
 * scanning for.
 */

export const TYPE_GROUPS = {
  image: { label: "Images", prefixes: ["image/"], exact: [] },
  video: { label: "Video", prefixes: ["video/"], exact: [] },
  audio: { label: "Audio", prefixes: ["audio/"], exact: [] },
  document: {
    label: "Documents",
    prefixes: [
      "text/",
      "application/vnd.openxmlformats-officedocument.",
      "application/vnd.oasis.opendocument.",
      "application/vnd.ms-",
    ],
    exact: [
      "application/pdf",
      "application/msword",
      "application/rtf",
      "application/epub+zip",
      "application/json",
      "application/xml",
      "message/rfc822",
    ],
  },
  archive: {
    label: "Archives",
    prefixes: [],
    exact: [
      "application/zip",
      "application/x-zip-compressed",
      "application/x-7z-compressed",
      "application/x-rar-compressed",
      "application/vnd.rar",
      "application/x-tar",
      "application/gzip",
      "application/x-gzip",
      "application/x-bzip2",
      "application/x-xz",
      "application/zstd",
    ],
  },
} as const;

export type TypeGroup = keyof typeof TYPE_GROUPS;

export const SEARCH_SORTS = [
  { id: "relevance", label: "Best match" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "name", label: "Name" },
  { id: "largest", label: "Largest" },
  { id: "smallest", label: "Smallest" },
] as const;

export type SearchSort = (typeof SEARCH_SORTS)[number]["id"];

export type SearchParams = {
  /** The typed text, trimmed. Empty means "filters only". */
  text: string;
  type: TypeGroup | null;
  /** Search inside this folder and everything beneath it. */
  folderId: string | null;
  from: Date | null;
  to: Date | null;
  minBytes: bigint | null;
  maxBytes: bigint | null;
  sort: SearchSort;
  offset: number;
  limit: number;
};

export const MIN_TEXT = 2;
export const PAGE_SIZE = 25;
const MAX_OFFSET = 10_000;

function date(raw: string | null, endOfDay: boolean): Date | null {
  if (!raw) return null;

  // A bare date means the whole of that day, inclusive at both ends.
  const value = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
    : new Date(raw);

  return Number.isNaN(value.getTime()) ? null : value;
}

function bytes(raw: string | null): bigint | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

export function parseSearchParams(query: URLSearchParams): SearchParams {
  const type = query.get("type");
  const sort = query.get("sort");
  const offset = Number(query.get("offset"));

  return {
    text: (query.get("q") ?? "").trim().slice(0, 200),
    type: type && type in TYPE_GROUPS ? (type as TypeGroup) : null,
    folderId: query.get("folder") || null,
    from: date(query.get("from"), false),
    to: date(query.get("to"), true),
    minBytes: bytes(query.get("min")),
    maxBytes: bytes(query.get("max")),
    sort: SEARCH_SORTS.some((option) => option.id === sort)
      ? (sort as SearchSort)
      : "relevance",
    offset:
      Number.isInteger(offset) && offset > 0 ? Math.min(offset, MAX_OFFSET) : 0,
    limit: PAGE_SIZE,
  };
}

/** Whether there is anything to search for at all. */
export function hasCriteria(params: SearchParams): boolean {
  return (
    params.text.length >= MIN_TEXT ||
    params.type !== null ||
    params.folderId !== null ||
    params.from !== null ||
    params.to !== null ||
    params.minBytes !== null ||
    params.maxBytes !== null
  );
}

/** A Prisma `where` fragment for a type group, shared by both providers. */
export function typeFilter(type: TypeGroup) {
  const group = TYPE_GROUPS[type];

  return {
    OR: [
      ...group.prefixes.map((prefix) => ({ mimeType: { startsWith: prefix } })),
      ...(group.exact.length > 0
        ? [{ mimeType: { in: [...group.exact] } }]
        : []),
    ],
  };
}
