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
    return <ImagePreview url={url} name={name} />;
  }

  if (kind === "pdf") {
    return (
      <iframe
        src={url}
        title={name}
        className="h-[70vh] w-full border border-line bg-white"
      />
    );
  }

  return <TextPreview url={url} />;
}

/** What a refused view says: previews count toward a link's transfer cap. */
const SPENT =
  "This link has used up its transfer allowance, so it can't show more. Ask the sender for a new one.";

/**
 * An <img> cannot tell a refusal from a broken file, so a failed load names
 * the likelier cause on a share page — the transfer cap is spent — rather
 * than leaving a broken-image icon.
 */
function ImagePreview({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <p
        role="alert"
        className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-fg"
      >
        This image could not be shown. If it came from a shared link, the link
        may have used up its transfer allowance.
      </p>
    );
  }

  return (
    // biome-ignore lint/performance/noImgElement: bytes from a guarded route, not an optimisable asset
    <img
      src={url}
      alt={name}
      onError={() => setFailed(true)}
      className="mx-auto max-h-[70vh] max-w-full object-contain"
    />
  );
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
                  : response.status === 429
                    ? SPENT
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
      <p className="py-6 text-center text-[13px] text-fg-subtle">Loading…</p>
    );
  }

  if (state.kind === "error") {
    return (
      <p
        role="alert"
        className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-fg"
      >
        {state.message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words border border-line bg-raised/40 p-3 font-mono text-[13px] leading-relaxed text-fg">
        {state.text || "(empty)"}
      </pre>
      {state.truncated && (
        <p className="text-[13px] text-fg-subtle">
          Showing the first 256 KB. Download the file to read the rest.
        </p>
      )}
    </div>
  );
}
