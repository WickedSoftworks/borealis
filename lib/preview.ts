/**
 * What may be shown inline, and as what.
 *
 * Pure — no React, no I/O — and the single source of truth for both the
 * pages that decide whether to offer a "View" control and the routes that
 * decide whether to serve one. If they disagreed, the difference would be
 * either a dead button or a way to render something the page never offered.
 *
 * Matched on MIME type alone, with no extension fallback. lib/extract.ts
 * guesses from extensions because a wrong guess there costs an index entry;
 * a wrong guess here costs a security boundary.
 *
 * Three deliberate properties:
 *
 * - `image/svg+xml` is absent. SVG is a script execution vector.
 * - The Content-Type is re-derived, never echoed. The stored `mimeType` came
 *   from the uploader's tus metadata, so the route sends the allowlist's value
 *   for the matched kind: an HTML payload stored as `text/plain` is served as
 *   `text/plain` and cannot execute.
 * - HTML is absent, and would stay absent even sandboxed. The iframe exists
 *   for PDF only.
 */

export type PreviewKind = "image" | "pdf" | "text";

export type PreviewClass = { kind: PreviewKind; contentType: string };

const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;

const TEXT_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
] as const;

/**
 * Previews are unmetered — a recipient viewing a page of images should not
 * spend the link's download cap — so this ceiling is what stops "preview" from
 * being an unmetered download of anything large. Text previews ask for only
 * their first slice with a Range request and never come near it.
 */
export const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;

/** How much of a text file the viewer fetches and renders. */
export const TEXT_PREVIEW_BYTES = 256 * 1024;

export function classifyPreview(mimeType: string): PreviewClass | null {
  const mime = mimeType.toLowerCase().split(";")[0].trim();

  const image = IMAGE_TYPES.find((type) => type === mime);
  if (image) return { kind: "image", contentType: image };

  if (mime === "application/pdf") {
    return { kind: "pdf", contentType: "application/pdf" };
  }

  if (TEXT_TYPES.some((type) => type === mime)) {
    return { kind: "text", contentType: "text/plain; charset=utf-8" };
  }

  return null;
}

/** Whether a specific file may be previewed at all, for the page to offer it. */
export function previewable(file: {
  mimeType: string;
  isEncrypted: boolean;
  size: bigint | number;
}): PreviewClass | null {
  if (file.isEncrypted) return null;

  const preview = classifyPreview(file.mimeType);
  if (!preview) return null;

  // Text is exempt: the viewer only ever fetches its first slice.
  if (preview.kind !== "text" && Number(file.size) > MAX_PREVIEW_BYTES) {
    return null;
  }

  return preview;
}
