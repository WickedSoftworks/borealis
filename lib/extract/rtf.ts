/**
 * Plain text out of RTF.
 *
 * RTF is a stream of control words, groups, and text. This keeps the text,
 * turns `\par` and `\line` into line breaks, decodes `\'hh` (a byte in the
 * document's code page, taken as Windows-1252 — what nearly every RTF writer
 * emits) and `\uN` (a UTF-16 unit, followed by a fallback character that is
 * skipped), and drops whole destination groups — font tables, colour tables,
 * stylesheets, embedded pictures, `{\*\…}` — which are data, not prose.
 */

const SKIP_DESTINATIONS = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "object",
  "header",
  "footer",
  "headerl",
  "headerr",
  "footerl",
  "footerr",
  "listtable",
  "listoverridetable",
  "rsidtbl",
  "generator",
  "xmlnstbl",
  "themedata",
  "colorschememapping",
  "datastore",
  "latentstyles",
]);

// Windows-1252's 0x80–0x9F, which differ from Latin-1.
const CP1252: Record<number, string> = {
  128: "€",
  130: "‚",
  131: "ƒ",
  132: "„",
  133: "…",
  134: "†",
  135: "‡",
  136: "ˆ",
  137: "‰",
  138: "Š",
  139: "‹",
  140: "Œ",
  142: "Ž",
  145: "‘",
  146: "’",
  147: "“",
  148: "”",
  149: "•",
  150: "–",
  151: "—",
  152: "˜",
  153: "™",
  154: "š",
  155: "›",
  156: "œ",
  158: "ž",
  159: "Ÿ",
};

export function rtfToText(rtf: string): string {
  let out = "";
  let i = 0;
  /** Depth at which a skipped destination began, or -1 when not skipping. */
  let skipFrom = -1;
  let depth = 0;
  /** Characters to drop after a \uN — the ANSI fallback for readers without Unicode. */
  let fallback = 0;
  let unicodeSkip = 1;

  const emit = (text: string) => {
    if (skipFrom >= 0) return;
    out += text;
  };

  while (i < rtf.length) {
    const char = rtf[i];

    if (char === "{") {
      depth++;
      i++;
      // `{\*\destination …}` is an optional destination — never text.
      if (rtf.startsWith("\\*", i) && skipFrom < 0) skipFrom = depth;
      continue;
    }

    if (char === "}") {
      if (skipFrom === depth) skipFrom = -1;
      depth--;
      i++;
      continue;
    }

    if (char === "\\") {
      const next = rtf[i + 1];

      if (next === "\\" || next === "{" || next === "}") {
        if (fallback > 0) fallback--;
        else emit(next);
        i += 2;
        continue;
      }

      if (next === "'") {
        const code = Number.parseInt(rtf.slice(i + 2, i + 4), 16);
        i += 4;
        if (fallback > 0) {
          fallback--;
          continue;
        }
        if (Number.isFinite(code))
          emit(CP1252[code] ?? String.fromCharCode(code));
        continue;
      }

      const word = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i, i + 40));

      if (!word) {
        // A control symbol: `\~` is a non-breaking space, `\-` an optional
        // hyphen, `\_` a non-breaking hyphen. Anything else is dropped.
        if (next === "~") emit(" ");
        if (next === "_") emit("-");
        i += 2;
        continue;
      }

      const [whole, name, param] = word;
      i += whole.length;

      if (SKIP_DESTINATIONS.has(name) && skipFrom < 0) {
        skipFrom = depth;
        continue;
      }

      switch (name) {
        case "par":
        case "line":
        case "sect":
        case "page":
        case "row":
          emit("\n");
          break;
        case "tab":
        case "cell":
          emit("\t");
          break;
        case "uc":
          unicodeSkip = Number(param ?? 1);
          break;
        case "u": {
          let code = Number(param ?? 0);
          if (code < 0) code += 65536;
          emit(String.fromCharCode(code));
          fallback = unicodeSkip;
          break;
        }
        case "emdash":
          emit("—");
          break;
        case "endash":
          emit("–");
          break;
        case "lquote":
          emit("‘");
          break;
        case "rquote":
          emit("’");
          break;
        case "ldblquote":
          emit("“");
          break;
        case "rdblquote":
          emit("”");
          break;
        case "bullet":
          emit("•");
          break;
      }
      continue;
    }

    // Raw line breaks in the source are formatting, not content.
    if (char !== "\r" && char !== "\n") {
      if (fallback > 0) fallback--;
      else emit(char);
    }
    i++;
  }

  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
