"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/world/dialog";
import type { PreviewKind } from "@/lib/preview";

/**
 * Look at a file without downloading it.
 *
 * What may be previewed, and the Content-Type it arrives as, is decided on the
 * server by lib/preview.ts — this only renders the three kinds that exist:
 *
 *   image  an <img>, which cannot run anything whatever the bytes are
 *   pdf    the browser's own viewer, in a frame, under a no-script policy
 *   text   fetched as text and placed in a <pre> — never parsed as markup
 *
 * Text arrives as its first slice only; the server says so with a header and
 * this says so to the reader, so a truncated log is never mistaken for a
 * short one.
 */
export function FilePreview({
  url,
  kind,
  name,
  children,
}: {
  url: string;
  kind: PreviewKind;
  name: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title={name} className="max-w-4xl">
        {open && <PreviewBody url={url} kind={kind} name={name} />}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  url,
  kind,
  name,
}: {
  url: string;
  kind: PreviewKind;
  name: string;
}) {
  if (kind === "image") {
    return (
      // biome-ignore lint/performance/noImgElement: bytes from a guarded route, not an optimisable asset
      <img
        src={url}
        alt={name}
        className="mx-auto max-h-[70vh] max-w-full object-contain"
      />
    );
  }

  if (kind === "pdf") {
    return (
      <iframe
        src={url}
        title={name}
        className="h-[70vh] w-full border border-dotted border-ink-20 bg-white"
      />
    );
  }

  return <TextPreview url={url} />;
}

function TextPreview({ url }: { url: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; text: string; truncated: boolean }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        const response = await fetch(url);

        if (!response.ok) {
          const message = await response.text().catch(() => "");
          if (live) {
            setState({
              kind: "error",
              message:
                response.status === 401
                  ? "This link needs its password again. Reload the page."
                  : message || "This file could not be opened.",
            });
          }
          return;
        }

        // Decoded with replacement rather than throwing: a slice can end in
        // the middle of a multi-byte character, and a file that is not quite
        // UTF-8 should still show what it can.
        const text = new TextDecoder("utf-8", { fatal: false }).decode(
          await response.arrayBuffer(),
        );

        if (live) {
          setState({
            kind: "ready",
            text,
            truncated: response.headers.get("X-Borealis-Truncated") === "true",
          });
        }
      } catch {
        if (live)
          setState({
            kind: "error",
            message: "This file could not be opened.",
          });
      }
    })();

    return () => {
      live = false;
    };
  }, [url]);

  if (state.kind === "loading") {
    return (
      <p className="py-6 text-center text-[0.75rem] text-ink-60">Loading…</p>
    );
  }

  if (state.kind === "error") {
    return (
      <p
        role="alert"
        className="bg-ink-100 px-2 py-1 text-[0.75rem] font-bold text-ground"
      >
        {state.message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words border border-dotted border-ink-20 bg-ink-00/40 p-3 font-mono text-[0.75rem] leading-relaxed text-ink-80">
        {state.text || "(empty)"}
      </pre>
      {state.truncated && (
        <p className="text-[0.6875rem] text-ink-60">
          Showing the first 256 KB. Download the file to read the rest.
        </p>
      )}
    </div>
  );
}
