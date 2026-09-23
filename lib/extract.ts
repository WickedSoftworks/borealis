import { emailToText } from "@/lib/extract/email";
import { epubText, odfText, pptxText, xlsxText } from "@/lib/extract/office";
import { rtfToText } from "@/lib/extract/rtf";
import { markupToText } from "@/lib/extract/text";

/**
 * Pull readable text out of an uploaded file so it can be searched.
 *
 * Deliberately conservative: unknown formats return an explicit `skipped`
 * reason rather than guessing, and encrypted uploads never reach here at all —
 * the server holds only ciphertext for those and has nothing to extract.
 *
 * The reason string is the honest answer to "why can't I find this file", so
 * it is kept specific. OCR is not implemented, and nothing here may say or
 * imply otherwise (PRODUCT.md): a scanned document is stored and served, and
 * reported as unindexed.
 */

/** Beyond this, indexing costs more than the search is worth at this scale. */
const MAX_EXTRACT_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_LENGTH = 400_000;

export type Extraction = { content: string } | { skipped: string };

export type ExtractMeta = {
  mimeType: string;
  name: string;
  size: bigint;
};

type Format =
  | "html"
  | "text"
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "odf"
  | "epub"
  | "rtf"
  | "email";

const BY_MIME: Record<string, Format> = {
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.oasis.opendocument.text": "odf",
  "application/vnd.oasis.opendocument.spreadsheet": "odf",
  "application/vnd.oasis.opendocument.presentation": "odf",
  "application/epub+zip": "epub",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "message/rfc822": "email",
};

const BY_EXTENSION: Record<string, Format> = {
  html: "html",
  htm: "html",
  xhtml: "html",
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
  odt: "odf",
  ods: "odf",
  odp: "odf",
  epub: "epub",
  rtf: "rtf",
  eml: "email",
};

function isPlainText(mimeType: string, name: string): boolean {
  if (mimeType.startsWith("text/")) return true;
  if (/^application\/(json|xml|yaml|x-yaml|toml)$/.test(mimeType)) return true;

  return /\.(txt|md|markdown|csv|tsv|log|json|yaml|yml|toml|ini|conf)$/i.test(
    name,
  );
}

/**
 * Which extractor a file gets. Browsers report many of these formats as
 * `application/octet-stream` or `application/zip`, so the extension is a
 * fallback — which is safe here, unlike in preview, because a wrong guess
 * costs an index entry rather than a security boundary.
 */
export function formatOf(mimeType: string, name: string): Format | null {
  const mime = mimeType.toLowerCase().split(";")[0].trim();

  if (BY_MIME[mime]) return BY_MIME[mime];

  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (extension && BY_EXTENSION[extension]) return BY_EXTENSION[extension];

  return isPlainText(mime, name) ? "text" : null;
}

function done(text: string, emptyReason: string): Extraction {
  const content = text.trim();

  return content
    ? { content: content.slice(0, MAX_TEXT_LENGTH) }
    : { skipped: emptyReason };
}

/**
 * `load` is called only when the file is worth reading, so an oversized or
 * unsupported upload never has its bytes pulled from storage at all.
 */
export async function extractText(
  load: () => Promise<Buffer>,
  meta: ExtractMeta,
): Promise<Extraction> {
  const format = formatOf(meta.mimeType, meta.name);

  if (!format) {
    return { skipped: `no extractor for ${meta.mimeType || "this file type"}` };
  }

  if (meta.size > BigInt(MAX_EXTRACT_BYTES)) {
    return { skipped: "file is too large to index" };
  }

  try {
    const buffer = await load();

    switch (format) {
      case "text":
        return done(buffer.toString("utf8"), "file is empty");

      case "html":
        return done(
          markupToText(buffer.toString("utf8")),
          "page contained no text",
        );

      case "pdf": {
        const { extractText: extractPdf, getDocumentProxy } = await import(
          "unpdf"
        );
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const { text } = await extractPdf(pdf, { mergePages: true });

        // A PDF of scans yields nothing here. Say so plainly rather than
        // storing an empty index entry that looks like a successful extraction.
        return done(
          Array.isArray(text) ? text.join("\n") : text,
          "no embedded text (likely a scan — OCR not enabled)",
        );
      }

      case "docx": {
        const mammoth = await import("mammoth");
        const { value } = await mammoth.extractRawText({ buffer });
        return done(value, "document contained no text");
      }

      case "xlsx":
        return done(await xlsxText(buffer), "spreadsheet contained no text");

      case "pptx":
        return done(await pptxText(buffer), "presentation contained no text");

      case "odf":
        return done(await odfText(buffer), "document contained no text");

      case "epub":
        return done(await epubText(buffer), "book contained no text");

      case "rtf":
        return done(
          rtfToText(buffer.toString("latin1")),
          "document contained no text",
        );

      case "email":
        return done(
          emailToText(buffer.toString("utf8")),
          "message contained no text",
        );
    }
  } catch (error) {
    return {
      skipped: `extraction failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
