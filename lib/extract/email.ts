import { markupToText } from "./text";

/**
 * Searchable text out of a saved email (`.eml`, `message/rfc822`).
 *
 * The subject and the correspondents are what someone searching a mailbox
 * export types, so they go first; then the readable body. MIME is walked to
 * the text parts — `text/plain` preferred, `text/html` stripped when it is all
 * there is — and transfer encodings are undone. Attachments are skipped: they
 * are separate files in any sensible export, and base64 of a JPEG is not text.
 */

type Part = { headers: Map<string, string>; body: string };

function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  // Folded header lines continue with leading whitespace.
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");

  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.set(
      line.slice(0, colon).trim().toLowerCase(),
      line.slice(colon + 1).trim(),
    );
  }

  return headers;
}

function splitPart(raw: string): Part {
  const boundary = /\r?\n\r?\n/.exec(raw);

  if (!boundary) return { headers: parseHeaders(raw), body: "" };

  return {
    headers: parseHeaders(raw.slice(0, boundary.index)),
    body: raw.slice(boundary.index + boundary[0].length),
  };
}

function parameter(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const match = new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, "i").exec(header);
  return match ? match[1].trim() : null;
}

function decodeBody(part: Part): string {
  const encoding = part.headers.get("content-transfer-encoding")?.toLowerCase();
  const charset =
    parameter(part.headers.get("content-type"), "charset") ?? "utf-8";

  let bytes: Buffer;

  if (encoding === "base64") {
    bytes = Buffer.from(part.body.replace(/\s+/g, ""), "base64");
  } else if (encoding === "quoted-printable") {
    const joined = part.body.replace(/=\r?\n/g, "");
    const out: number[] = [];

    for (let i = 0; i < joined.length; i++) {
      if (
        joined[i] === "=" &&
        /^[0-9A-F]{2}$/i.test(joined.slice(i + 1, i + 3))
      ) {
        out.push(Number.parseInt(joined.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        out.push(joined.charCodeAt(i) & 0xff);
      }
    }

    bytes = Buffer.from(out);
  } else {
    return part.body;
  }

  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

/** RFC 2047 encoded words in headers: `=?UTF-8?B?…?=` and `=?…?Q?…?=`. */
function decodeHeader(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi,
    (_match, charset: string, kind: string, text: string) => {
      const bytes =
        kind.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(
              text
                .replace(/_/g, " ")
                .replace(/=([0-9A-F]{2})/gi, (_m, hex: string) =>
                  String.fromCharCode(Number.parseInt(hex, 16)),
                ),
              "latin1",
            );

      try {
        return new TextDecoder(charset).decode(bytes);
      } catch {
        return bytes.toString("utf8");
      }
    },
  );
}

/** The readable text of a part, or of the best alternative inside it. */
function bodyText(part: Part, depth = 0): string {
  const type = part.headers.get("content-type")?.toLowerCase() ?? "text/plain";
  const disposition =
    part.headers.get("content-disposition")?.toLowerCase() ?? "";

  if (disposition.startsWith("attachment")) return "";

  if (type.startsWith("multipart/") && depth < 8) {
    const boundary = parameter(part.headers.get("content-type"), "boundary");
    if (!boundary) return "";

    const pieces = part.body
      .split(`--${boundary}`)
      .slice(1)
      .filter((piece) => !piece.startsWith("--"))
      .map((piece) => splitPart(piece.replace(/^\r?\n/, "")));

    // In an alternative, prefer the plain rendering; otherwise take every part.
    if (type.startsWith("multipart/alternative")) {
      const plain = pieces.find((piece) =>
        (piece.headers.get("content-type") ?? "text/plain")
          .toLowerCase()
          .startsWith("text/plain"),
      );

      return bodyText(plain ?? pieces[pieces.length - 1] ?? part, depth + 1);
    }

    return pieces
      .map((piece) => bodyText(piece, depth + 1))
      .filter(Boolean)
      .join("\n\n");
  }

  if (type.startsWith("text/html")) return markupToText(decodeBody(part));
  if (type.startsWith("text/")) return decodeBody(part).trim();

  return "";
}

export function emailToText(raw: string): string {
  const message = splitPart(raw);
  const header = (name: string) =>
    decodeHeader(message.headers.get(name) ?? "");

  const lines = [
    header("subject") && `Subject: ${header("subject")}`,
    header("from") && `From: ${header("from")}`,
    header("to") && `To: ${header("to")}`,
    header("cc") && `Cc: ${header("cc")}`,
    header("date") && `Date: ${header("date")}`,
  ].filter(Boolean);

  const body = bodyText(message);

  return [...lines, "", body].join("\n").trim();
}
