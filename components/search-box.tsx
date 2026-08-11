"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { IconFile } from "@/components/world/icons";
import { formatBytes } from "@/lib/format";

type Results = {
  files: Array<{ id: string; originalName: string; size: number }>;
  contents: Array<{
    fileId: string;
    originalName: string;
    snippet: string | null;
  }>;
};

export function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [pending, setPending] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }

    // Debounced, and the previous request is cancelled so a slow response
    // cannot overwrite a newer one.
    const timer = setTimeout(async () => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      setPending(true);

      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        setResults(await response.json());
      } catch {
        // Aborted or offline — leave the previous results in place.
      } finally {
        setPending(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const total = (results?.files.length ?? 0) + (results?.contents.length ?? 0);

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search filenames and document contents…"
        aria-label="Search your files"
      />

      {query.trim().length >= 2 && (
        <div aria-live="polite" className="text-[0.6875rem] text-ink-60">
          {pending ? "Searching…" : `${total} result${total === 1 ? "" : "s"}`}
        </div>
      )}

      {results && total > 0 && (
        <ul className="border border-dotted border-ink-20">
          {results.files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-3 border-b border-dotted border-ink-20 px-3 py-2 last:border-b-0"
            >
              <IconFile className="size-4 shrink-0 text-ink-60" />
              <a
                href={`/api/file/${file.id}`}
                className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-80 underline-offset-4 hover:underline"
              >
                {file.originalName}
              </a>
              <span className="shrink-0 text-[0.6875rem] tabular-nums text-ink-60">
                {formatBytes(file.size)}
              </span>
            </li>
          ))}

          {results.contents.map((hit) => (
            <li
              key={hit.fileId}
              className="border-b border-dotted border-ink-20 px-3 py-2 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <IconFile className="size-4 shrink-0 text-ink-60" />
                <a
                  href={`/api/file/${hit.fileId}`}
                  className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-80 underline-offset-4 hover:underline"
                >
                  {hit.originalName}
                </a>
              </div>
              {hit.snippet && (
                <p className="mt-1 pl-7 text-[0.6875rem] leading-relaxed text-ink-60">
                  {hit.snippet}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
