import {
  findEntries,
  listEntries,
  readEntry,
  type ZipEntry,
} from "@/lib/zip/read";
import { elementText, markupToText } from "./text";

/**
 * The ZIP-of-XML formats: spreadsheets, presentations, OpenDocument, EPUB.
 *
 * Each knows where its words live inside the archive and reads only those
 * entries — a PPTX's slide XML, not its media folder — with every read capped
 * by lib/zip/read.ts, so a crafted archive cannot inflate its way out of the
 * extractor's memory budget.
 */

const PER_ENTRY_LIMIT = 8 * 1024 * 1024;

async function text(buffer: Buffer, entry: ZipEntry): Promise<string> {
  return (await readEntry(buffer, entry, PER_ENTRY_LIMIT)).toString("utf8");
}

/** `slide10.xml` after `slide9.xml`, as the author ordered them. */
function numericOrder(a: ZipEntry, b: ZipEntry): number {
  const n = (entry: ZipEntry) =>
    Number(/(\d+)\.xml$/.exec(entry.name)?.[1] ?? 0);
  return n(a) - n(b);
}

export async function xlsxText(buffer: Buffer): Promise<string> {
  const entries = listEntries(buffer);
  const parts: string[] = [];

  // Sheet names are how people remember a workbook ("the Q3 tab").
  for (const workbook of findEntries(entries, "xl/workbook.xml")) {
    const xml = await text(buffer, workbook);
    for (const match of xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)) {
      parts.push(match[1]);
    }
  }

  // Nearly all cell text lives once in the shared-strings table.
  for (const shared of findEntries(entries, "xl/sharedStrings.xml")) {
    parts.push(elementText(await text(buffer, shared), "t", "\n"));
  }

  // Inline strings are the exception some generators prefer.
  for (const sheet of findEntries(
    entries,
    /^xl\/worksheets\/sheet\d+\.xml$/,
  ).sort(numericOrder)) {
    const xml = await text(buffer, sheet);
    for (const inline of xml.matchAll(/<is>([\s\S]*?)<\/is>/g)) {
      parts.push(elementText(inline[1], "t"));
    }
  }

  return parts.filter(Boolean).join("\n");
}

export async function pptxText(buffer: Buffer): Promise<string> {
  const entries = listEntries(buffer);
  const parts: string[] = [];

  for (const slide of findEntries(entries, /^ppt\/slides\/slide\d+\.xml$/).sort(
    numericOrder,
  )) {
    parts.push(elementText(await text(buffer, slide), "a:t"));
  }

  // Speaker notes are often where the actual words are.
  for (const notes of findEntries(
    entries,
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/,
  ).sort(numericOrder)) {
    parts.push(elementText(await text(buffer, notes), "a:t"));
  }

  return parts.filter(Boolean).join("\n\n");
}

/** ODT, ODS, and ODP all keep their text in `content.xml`. */
export async function odfText(buffer: Buffer): Promise<string> {
  const entries = listEntries(buffer);
  const [content] = findEntries(entries, "content.xml");

  if (!content) return "";

  // The document body only: automatic styles precede it and are not prose.
  const xml = await text(buffer, content);
  const body = /<office:body>([\s\S]*)<\/office:body>/.exec(xml)?.[1] ?? xml;

  return markupToText(body);
}

/**
 * EPUB: every XHTML document in the book. Taken in archive order, which is
 * nearly always reading order; parsing the OPF spine to be exact would buy
 * better snippets for a handful of books at the cost of a third parser.
 */
export async function epubText(buffer: Buffer): Promise<string> {
  const entries = listEntries(buffer);
  const parts: string[] = [];

  for (const chapter of findEntries(entries, /\.(x?html?)$/i)) {
    parts.push(markupToText(await text(buffer, chapter)));
  }

  return parts.filter(Boolean).join("\n\n");
}
