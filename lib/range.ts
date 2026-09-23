/**
 * HTTP byte-range arithmetic.
 *
 * Everything here is pure: no request, no storage, no database. Range parsing
 * is the kind of code that is wrong in ways nobody notices until a video
 * scrubs to the wrong second or a resumed download silently loses a byte, so
 * it is split out to be tested exhaustively on its own. The seam that acts on
 * these verdicts is lib/download.ts.
 *
 * Both ends of a `ByteRange` are INCLUSIVE, matching HTTP. That is also what
 * `fs.createReadStream({ start, end })` and S3's `Range: bytes=a-b` want, so
 * a verdict travels from here down to storage with no off-by-one translation
 * anywhere in between.
 */

/** A resolved, satisfiable range. `start` and `end` are both inclusive. */
export type ByteRange = { start: number; end: number };

export type RangeVerdict =
  /** Serve the whole object: 200, no Content-Range. */
  | { kind: "full" }
  /** Serve a slice: 206, with Content-Range. */
  | { kind: "partial"; range: ByteRange }
  /** Refuse: 416, with the unsatisfiable `Content-Range` form. */
  | { kind: "unsatisfiable" };

const BYTES_UNIT = /^bytes\s*=/i;
const SINGLE_SPEC = /^(\d*)-(\d*)$/;

/**
 * Resolve a `Range` request header against an object of `size` bytes.
 *
 * The distinction between "full" and "partial" is not cosmetic: a share's
 * download counter increments on a full request and not on a partial one, so
 * `Range: bytes=0-` on a complete object must come back as `full` rather than
 * as a partial that happens to span everything. A client asking for all of it
 * is downloading it, whatever header it used to ask.
 *
 * Two ways to say no, and they are different:
 *
 * - Returning `full` ignores the header. That is what RFC 9110 requires for a
 *   range unit we do not implement, and what it permits for anything else we
 *   would rather not answer — a multi-range request, say.
 * - Returning `unsatisfiable` refuses with a 416. Reserved for a `bytes=`
 *   request we understood and cannot honour: past the end of the object,
 *   inverted, or malformed. Serving 4 GB to a client that asked for something
 *   incoherent is the worse failure, so a garbled `bytes=` spec is refused
 *   rather than quietly widened to the whole file.
 */
export function parseRange(
  header: string | null | undefined,
  size: number,
): RangeVerdict {
  if (!header) return { kind: "full" };

  const trimmed = header.trim();

  // An unrecognised unit ("items=0-9") is not ours to answer. RFC 9110 §14.2.
  if (!BYTES_UNIT.test(trimmed)) return { kind: "full" };

  const spec = trimmed.replace(BYTES_UNIT, "").trim();

  // Multiple ranges would need a multipart/byteranges body. No browser or
  // media player needs one, and answering with the whole object is explicitly
  // allowed, so the framing is not worth writing.
  if (spec.includes(",")) return { kind: "full" };

  const match = SINGLE_SPEC.exec(spec);

  if (!match) return { kind: "unsatisfiable" };

  const [, rawStart, rawEnd] = match;

  // A zero-length object satisfies nothing. `bytes=0-` against it is asking
  // for byte 0, which does not exist.
  if (size <= 0) return { kind: "unsatisfiable" };

  let start: number;
  let end: number;

  if (rawStart === "") {
    // Suffix form: `bytes=-500` is the LAST 500 bytes, not "up to byte 500".
    if (rawEnd === "") return { kind: "unsatisfiable" };

    const wanted = Number(rawEnd);

    if (wanted === 0) return { kind: "unsatisfiable" };

    // Asking for more trailing bytes than exist yields the whole object.
    start = Math.max(0, size - wanted);
    end = size - 1;
  } else {
    start = Number(rawStart);

    if (start >= size) return { kind: "unsatisfiable" };

    // An absent end means "to the end of the object"; one past the end is
    // clamped rather than refused, which is how a client that guessed the
    // size high still gets its bytes.
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);

    if (end < start) return { kind: "unsatisfiable" };
  }

  if (start === 0 && end === size - 1) return { kind: "full" };

  return { kind: "partial", range: { start, end } };
}

/**
 * The `Content-Range` header value.
 *
 * `null` produces the unsatisfiable form, which a 416 must carry so the client
 * learns the real size and can ask again without guessing.
 */
export function contentRange(range: ByteRange | null, size: number): string {
  if (!range) return `bytes */${size}`;

  return `bytes ${range.start}-${range.end}/${size}`;
}

/** How many bytes a verdict will put on the wire. */
export function rangeLength(verdict: RangeVerdict, size: number): number {
  if (verdict.kind === "full") return size;
  if (verdict.kind === "partial") {
    return verdict.range.end - verdict.range.start + 1;
  }

  return 0;
}
