/**
 * Pull readable text out of an uploaded file so it can be searched.
 *
 * Deliberately conservative: unknown formats return null rather than guessing,
 * and encrypted uploads never reach here at all — the server holds only
 * ciphertext for those and has nothing to extract.
 */

/** Beyond this, indexing costs more than the search is worth at this scale. */
const MAX_EXTRACT_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_LENGTH = 400_000;

export type Extraction = { content: string } | { skipped: string };

function isPlainText(mimeType: string, name: string): boolean {
  if (mimeType.startsWith("text/")) return true;
  if (/^application\/(json|xml|yaml|x-yaml|toml)$/.test(mimeType)) return true;

  return /\.(txt|md|markdown|csv|tsv|log|json|yaml|yml|toml|ini|conf)$/i.test(
    name,
  );
}

export async function extractText(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
): Promise<Extraction> {
  if (buffer.byteLength > MAX_EXTRACT_BYTES) {
    return { skipped: "file is too large to index" };
  }

  try {
    if (isPlainText(mimeType, originalName)) {
      return { content: buffer.toString("utf8").slice(0, MAX_TEXT_LENGTH) };
    }

    if (mimeType === "application/pdf" || /\.pdf$/i.test(originalName)) {
      const { extractText: extractPdf, getDocumentProxy } = await import(
        "unpdf"
      );
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractPdf(pdf, { mergePages: true });

      const content = (Array.isArray(text) ? text.join("\n") : text).trim();

      // A PDF of scans yields nothing here. That is where OCR would go; until
      // then say so plainly rather than storing an empty index entry that looks
      // like a successful extraction.
      return content
        ? { content: content.slice(0, MAX_TEXT_LENGTH) }
        : { skipped: "no embedded text (likely a scan — OCR not enabled)" };
    }

    if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      /\.docx$/i.test(originalName)
    ) {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer });

      return value.trim()
        ? { content: value.slice(0, MAX_TEXT_LENGTH) }
        : { skipped: "document contained no text" };
    }

    return { skipped: `no extractor for ${mimeType || "this file type"}` };
  } catch (error) {
    return {
      skipped: `extraction failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
