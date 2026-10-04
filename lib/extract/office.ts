import {
  findEntries,
  listEntries,
  readEntry,
  type ZipEntry,
} from "@/lib/zip/read";
import { decodeEntities, elementText, markupToText } from "./text";

/**
 * The ZIP-of-XML formats: word processing, spreadsheets, presentations,
 * OpenDocument, EPUB.
 *
 * Each knows where its words live inside the archive and reads only those
 * entries — a PPTX's slide XML, not its media folder — with every read capped
 * by lib/zip/read.ts, so a crafted archive cannot inflate its way out of the
 * extractor's memory budget.
 */

const PER_ENTRY_LIMIT = 8 * 1024 * 1024;

/**
 * What one document may cost across every entry it reads.
 *
 * Capping each entry alone bounded nothing: a few kilobytes of archive can
 * name thousands of entries that each inflate to the cap, and every one was
 * read and kept. Reading now stops at whichever runs out first — inflated
 * bytes, entries read, or as much text as the index will keep.
 */
const DOCUMENT_INFLATE_BUDGET = 64 * 1024 * 1024;
const MAX_ENTRIES_READ = 2_000;

type Document = {
  /** An entry's text, or null once the document's budget is spent. */
  read(entry: ZipEntry): Promise<string | null>;
  add(text: string): void;
  join(separator: string): string;
};

function openDocument(buffer: Buffer, textLimit: number): Document {
  let inflateLeft = DOCUMENT_INFLATE_BUDGET;
  let entriesLeft = MAX_ENTRIES_READ;
  let textLength = 0;
  const parts: string[] = [];

  return {
    async read(entry) {
      if (inflateLeft <= 0 || entriesLeft <= 0 || textLength >= textLimit) {
        return null;
      }

      entriesLeft--;
      const bytes = await readEntry(
        buffer,
        entry,
        Math.min(PER_ENTRY_LIMIT, inflateLeft),
      );
      inflateLeft -= bytes.length;

      return bytes.toString("utf8");
    },

    add(text) {
      if (!text) return;
      parts.push(text);
      textLength += text.length;
    },

    join(separator) {
      return parts.join(separator);
    },
  };
}

/** `slide10.xml` after `slide9.xml`, as the author ordered them. */
function numericOrder(a: ZipEntry, b: ZipEntry): number {
  const n = (entry: ZipEntry) =>
    Number(/(\d+)\.xml$/.exec(entry.name)?.[1] ?? 0);
  return n(a) - n(b);
}

/**
 * WordprocessingML, one line per paragraph. Only `<w:t>` runs are words —
 * field codes (`w:instrText`) and tracked deletions (`w:delText`) are not —
 * and runs are joined as written, since a run boundary is a style change, not
 * a space.
 */
const WORD_RUN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g;

function wordParagraphs(xml: string): string {
  return xml
    .split(/<\/w:p>/)
    .map((paragraph) => {
      let line = "";

      for (const match of paragraph.matchAll(WORD_RUN)) {
        if (match[1] !== undefined) line += decodeEntities(match[1]);
        else line += match[2] === "tab" ? "\t" : "\n";
      }

      return line.trim();
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * DOCX: the body, then headers and footers, then footnotes and endnotes.
 *
 * Read here rather than through mammoth, which inflated whole entries with
 * no limit at all — a DOCX is as much a zip bomb as any other archive.
 */
export async function docxText(
  buffer: Buffer,
  textLimit = Number.POSITIVE_INFINITY,
): Promise<string> {
  const entries = listEntries(buffer);
  const doc = openDocument(buffer, textLimit);

  for (const entry of [
    ...findEntries(entries, "word/document.xml"),
    ...findEntries(entries, /^word\/(header|footer)\d*\.xml$/).sort(
      numericOrder,
    ),
    ...findEntries(entries, /^word\/(footnotes|endnotes)\.xml$/),
  ]) {
    const xml = await doc.read(entry);
    if (xml === null) break;
    doc.add(wordParagraphs(xml));
  }

  return doc.join("\n");
}

export async function xlsxText(
  buffer: Buffer,
  textLimit = Number.POSITIVE_INFINITY,
): Promise<string> {
  const entries = listEntries(buffer);
  const doc = openDocument(buffer, textLimit);

  // Sheet names are how people remember a workbook ("the Q3 tab").
  for (const workbook of findEntries(entries, "xl/workbook.xml")) {
    const xml = await doc.read(workbook);
    if (xml === null) break;
    for (const match of xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)) {
      doc.add(match[1]);
    }
  }

  // Nearly all cell text lives once in the shared-strings table.
  for (const shared of findEntries(entries, "xl/sharedStrings.xml")) {
    const xml = await doc.read(shared);
    if (xml === null) break;
    doc.add(elementText(xml, "t", "\n"));
  }

  // Inline strings are the exception some generators prefer.
  for (const sheet of findEntries(
    entries,
    /^xl\/worksheets\/sheet\d+\.xml$/,
  ).sort(numericOrder)) {
    const xml = await doc.read(sheet);
    if (xml === null) break;
    for (const inline of xml.matchAll(/<is>([\s\S]*?)<\/is>/g)) {
      doc.add(elementText(inline[1], "t"));
    }
  }

  return doc.join("\n");
}

export async function pptxText(
  buffer: Buffer,
  textLimit = Number.POSITIVE_INFINITY,
): Promise<string> {
  const entries = listEntries(buffer);
  const doc = openDocument(buffer, textLimit);

  for (const entry of [
    ...findEntries(entries, /^ppt\/slides\/slide\d+\.xml$/).sort(numericOrder),
    // Speaker notes are often where the actual words are.
    ...findEntries(entries, /^ppt\/notesSlides\/notesSlide\d+\.xml$/).sort(
      numericOrder,
    ),
  ]) {
    const xml = await doc.read(entry);
    if (xml === null) break;
    doc.add(elementText(xml, "a:t"));
  }

  return doc.join("\n\n");
}

/** ODT, ODS, and ODP all keep their text in `content.xml`. */
export async function odfText(
  buffer: Buffer,
  textLimit = Number.POSITIVE_INFINITY,
): Promise<string> {
  const entries = listEntries(buffer);
  const [content] = findEntries(entries, "content.xml");

  if (!content) return "";

  const xml = await openDocument(buffer, textLimit).read(content);
  if (xml === null) return "";

  // The document body only: automatic styles precede it and are not prose.
  const body = /<office:body>([\s\S]*)<\/office:body>/.exec(xml)?.[1] ?? xml;

  return markupToText(body);
}

/**
 * EPUB: every XHTML document in the book. Taken in archive order, which is
 * nearly always reading order; parsing the OPF spine to be exact would buy
 * better snippets for a handful of books at the cost of a third parser.
 */
export async function epubText(
  buffer: Buffer,
  textLimit = Number.POSITIVE_INFINITY,
): Promise<string> {
  const entries = listEntries(buffer);
  const doc = openDocument(buffer, textLimit);

  for (const chapter of findEntries(entries, /\.(x?html?)$/i)) {
    const xml = await doc.read(chapter);
    if (xml === null) break;
    doc.add(markupToText(xml));
  }

  return doc.join("\n\n");
}
