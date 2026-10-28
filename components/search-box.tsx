"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { FilePreview } from "@/components/file-preview";
import type { FolderViewNode } from "@/components/folder-tree";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconDownload, IconFile } from "@/components/world/icons";
import { StateTag } from "@/components/world/panel";
import { recallKey } from "@/lib/crypto/keyring";
import { downloadEncrypted } from "@/lib/crypto/save";
import { formatBytes } from "@/lib/format";
import type { PreviewKind } from "@/lib/preview";
import { SEARCH_SORTS, TYPE_GROUPS } from "@/lib/search/params";

type Hit = {
  fileId: string;
  originalName: string;
  size: number;
  mimeType: string;
  createdAt: string;
  folderId: string | null;
  isEncrypted: boolean;
  matchedIn: "name" | "content" | "both" | null;
  snippet: string | null;
  previewKind: PreviewKind | null;
};

type Filters = {
  type: string;
  folder: string;
  from: string;
  to: string;
  minMb: string;
  maxMb: string;
  sort: string;
};

const EMPTY: Filters = {
  type: "",
  folder: "",
  from: "",
  to: "",
  minMb: "",
  maxMb: "",
  sort: "relevance",
};

const SELECT =
  "h-10 w-full rounded-lg border border-field-edge bg-paper px-3 text-base text-fg sm:text-sm";

function flatten(
  nodes: FolderViewNode[],
  prefix = "",
): Array<{ id: string; path: string }> {
  return nodes.flatMap((node) => [
    { id: node.id, path: `${prefix}${node.name}` },
    ...flatten(node.children, `${prefix}${node.name} / `),
  ]);
}

function paramsFor(query: string, filters: Filters, offset: number): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (filters.type) params.set("type", filters.type);
  if (filters.folder) params.set("folder", filters.folder);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.minMb)
    params.set("min", String(Math.round(Number(filters.minMb) * 1024 * 1024)));
  if (filters.maxMb)
    params.set("max", String(Math.round(Number(filters.maxMb) * 1024 * 1024)));
  if (filters.sort !== "relevance") params.set("sort", filters.sort);
  if (offset > 0) params.set("offset", String(offset));
  return params.toString();
}

/**
 * Find a file by name, by what is inside it, or by what kind of thing it is.
 *
 * Text searches names and extracted contents together and says which one
 * matched; the filters narrow by type, folder, date, and size, and work with
 * no text at all ("every PDF over 10 MB from March"). Results come a page at
 * a time with the full count stated, where the old box stopped silently at 25.
 */
export function SearchBox({ folders }: { folders: FolderViewNode[] }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [showFilters, setShowFilters] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  // The server stopped matching contents at its cap; say so with the count.
  const [capped, setCapped] = useState(false);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const filtered = Object.entries(filters).some(
    ([key, value]) => key !== "sort" && value !== "",
  );
  const active = query.trim().length >= 2 || filtered;
  const key = paramsFor(query, filters, 0);

  // Debounced; the previous request is cancelled so a slow response cannot
  // overwrite a newer one.
  useEffect(() => {
    if (!active) {
      setHits([]);
      setTotal(null);
      return;
    }

    const timer = setTimeout(async () => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      setPending(true);

      try {
        const response = await fetch(`/api/search?${key}`, {
          signal: controller.signal,
        });
        const body = await response.json();
        setHits(body.hits ?? []);
        setTotal(body.total ?? 0);
        setCapped(Boolean(body.capped));
      } catch {
        // Aborted or offline — leave the previous results in place.
      } finally {
        setPending(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [active, key]);

  async function loadMore() {
    setPending(true);

    try {
      const response = await fetch(
        `/api/search?${paramsFor(query, filters, hits.length)}`,
      );
      const body = await response.json();
      setHits((current) => [...current, ...(body.hits ?? [])]);
      setTotal(body.total ?? total);
    } finally {
      setPending(false);
    }
  }

  async function saveEncrypted(hit: Hit) {
    const encodedKey = recallKey(hit.fileId);

    if (!encodedKey) {
      setNote(
        `The key for ${hit.originalName} is not in this browser, so it cannot be decrypted here.`,
      );
      return;
    }

    setNote("Decrypting in this browser…");

    try {
      await downloadEncrypted(
        `/api/file/${hit.fileId}`,
        encodedKey,
        hit.originalName,
        hit.mimeType,
      );
      setNote(null);
    } catch (cause) {
      setNote(
        cause instanceof Error ? cause.message : "Could not decrypt that file.",
      );
    }
  }

  const folderOptions = flatten(folders);
  const set = (name: keyof Filters) => (event: { target: { value: string } }) =>
    setFilters((current) => ({ ...current, [name]: event.target.value }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            strokeWidth={1.75}
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search names and what’s inside…"
            aria-label="Search your files"
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          variant={showFilters || filtered ? "default" : "quiet"}
          aria-expanded={showFilters}
          aria-controls={`${id}-filters`}
          onClick={() => setShowFilters(!showFilters)}
        >
          Filters{filtered ? " •" : ""}
        </Button>
      </div>

      {showFilters && (
        <div
          id={`${id}-filters`}
          className="grid gap-3 rounded-xl border border-line bg-paper p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-fg">
            Type
            <select
              value={filters.type}
              onChange={set("type")}
              className={SELECT}
            >
              <option value="">Anything</option>
              {Object.entries(TYPE_GROUPS).map(([value, group]) => (
                <option key={value} value={value}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-fg">
            In folder
            <select
              value={filters.folder}
              onChange={set("folder")}
              className={SELECT}
            >
              <option value="">Whole vault</option>
              {folderOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.path}
                </option>
              ))}
            </select>
          </label>

          {(
            [
              ["from", "Uploaded from", "date"],
              ["to", "Until", "date"],
              ["minMb", "Larger than (MB)", "number"],
              ["maxMb", "Smaller than (MB)", "number"],
            ] as const
          ).map(([name, label, type]) => (
            <div
              key={name}
              className="flex flex-col gap-1.5 text-[13px] font-medium text-fg"
            >
              <label htmlFor={`${id}-${name}`}>{label}</label>
              <Input
                id={`${id}-${name}`}
                type={type}
                min={type === "number" ? 0 : undefined}
                value={filters[name]}
                onChange={set(name)}
              />
            </div>
          ))}

          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-fg">
            Order
            <select
              value={filters.sort}
              onChange={set("sort")}
              className={SELECT}
            >
              {SEARCH_SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <Button
              type="button"
              variant="quiet"
              size="sm"
              disabled={!filtered && filters.sort === "relevance"}
              onClick={() => setFilters(EMPTY)}
            >
              Clear filters
            </Button>
          </div>
        </div>
      )}

      {active && (
        <div aria-live="polite" className="text-[13px] text-fg-subtle">
          {pending && hits.length === 0
            ? "Searching…"
            : total === null
              ? ""
              : `${total} result${total === 1 ? "" : "s"}${
                  total > hits.length ? ` · showing ${hits.length}` : ""
                }${
                  capped
                    ? " · contents matched too many files, so only the newest are counted — narrow the search to see the rest"
                    : ""
                }`}
        </div>
      )}

      {hits.length > 0 && (
        <ul className="border-t border-line">
          {hits.map((hit) => (
            <li
              key={hit.fileId}
              className="border-b border-line px-2 py-2.5 transition-colors hover:bg-paper"
            >
              <div className="flex items-center gap-3">
                <IconFile className="size-4 shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {hit.originalName}
                </span>
                <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                  {hit.matchedIn === "content" && (
                    <StateTag tone="quiet">In contents</StateTag>
                  )}
                  {hit.matchedIn === "both" && (
                    <StateTag tone="quiet">Name + contents</StateTag>
                  )}
                  {hit.isEncrypted && <StateTag tone="e2e">Encrypted</StateTag>}
                </span>
                <span className="data shrink-0 text-fg-subtle">
                  {formatBytes(hit.size)} · {hit.createdAt.slice(0, 10)}
                </span>

                {hit.previewKind && (
                  <FilePreview
                    url={`/api/file/${hit.fileId}/preview`}
                    kind={hit.previewKind}
                    name={hit.originalName}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`View ${hit.originalName}`}
                    >
                      View
                    </Button>
                  </FilePreview>
                )}

                {hit.isEncrypted ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Decrypt and download ${hit.originalName}`}
                    onClick={() => saveEncrypted(hit)}
                  >
                    <IconDownload className="size-4" />
                  </Button>
                ) : (
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    aria-label={`Download ${hit.originalName}`}
                  >
                    <a href={`/api/file/${hit.fileId}`}>
                      <IconDownload className="size-4" />
                    </a>
                  </Button>
                )}
              </div>
              {hit.snippet && (
                <p className="mt-1 pl-7 text-[13px] leading-relaxed text-fg-subtle">
                  {hit.snippet}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {total !== null && total > hits.length && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="quiet"
            size="sm"
            disabled={pending}
            onClick={loadMore}
          >
            {pending
              ? "Loading…"
              : `Show ${Math.min(25, total - hits.length)} more`}
          </Button>
        </div>
      )}

      {note && <output className="block text-[13px] text-fg">{note}</output>}
    </div>
  );
}
