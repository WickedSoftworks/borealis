/**
 * Markup to searchable text.
 *
 * Every format added to extraction — office XML, OpenDocument, EPUB's XHTML,
 * HTML mail — reduces to "strip the tags, keep the words, keep paragraph
 * breaks so a snippet does not run two headings together". One function does
 * that for all of them, and it is a regex pass rather than a parser because
 * the output is an index entry: losing a word to malformed markup costs a
 * search hit, not a rendering.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);

        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }

      return NAMED[body.toLowerCase()] ?? match;
    },
  );
}

/**
 * Tags whose end is a line break in the text they contain: HTML blocks,
 * WordprocessingML and DrawingML paragraphs, OpenDocument paragraphs and
 * headings, spreadsheet cells and rows.
 */
const BLOCK_END =
  /<\/(p|div|h[1-6]|li|tr|td|th|br|section|article|blockquote|pre|title|w:p|a:p|text:p|text:h|table:table-cell|table:table-row|si|row|c)\s*>|<(br|w:br|text:line-break|text:tab)\s*\/?>/gi;

export function markupToText(markup: string): string {
  return decodeEntities(
    markup
      // Content that is markup about markup, not words.
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(BLOCK_END, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n[\s]*/g, "\n")
    .trim();
}

/**
 * Only the text inside one element type — `<a:t>` in a slide, `<t>` in a
 * shared-strings table — joined with a separator. Office XML puts a lot of
 * non-text data between those runs (positions, style ids) that the generic
 * strip would otherwise leave behind as noise.
 */
export function elementText(xml: string, tag: string, separator = " "): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`,
    "g",
  );

  const parts: string[] = [];

  for (const match of xml.matchAll(pattern)) {
    const text = decodeEntities(match[1].replace(/<[^>]+>/g, "")).trim();
    if (text) parts.push(text);
  }

  return parts.join(separator);
}
