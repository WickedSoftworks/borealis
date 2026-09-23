import { describe, expect, test } from "bun:test";
import { contentRange, parseRange, rangeLength } from "./range";

const SIZE = 1000;

describe("parseRange", () => {
  test("no header is a full request", () => {
    expect(parseRange(null, SIZE)).toEqual({ kind: "full" });
    expect(parseRange(undefined, SIZE)).toEqual({ kind: "full" });
    expect(parseRange("", SIZE)).toEqual({ kind: "full" });
  });

  test("a range spanning the whole object is full, not partial", () => {
    // The case the download counter turns on: a client that asks for
    // everything is downloading the file, whatever header it used.
    expect(parseRange("bytes=0-", SIZE)).toEqual({ kind: "full" });
    expect(parseRange("bytes=0-999", SIZE)).toEqual({ kind: "full" });
    expect(parseRange("bytes=-1000", SIZE)).toEqual({ kind: "full" });
    expect(parseRange("bytes=-5000", SIZE)).toEqual({ kind: "full" });
  });

  test("reads an explicit range inclusively at both ends", () => {
    expect(parseRange("bytes=0-99", SIZE)).toEqual({
      kind: "partial",
      range: { start: 0, end: 99 },
    });
    expect(rangeLength(parseRange("bytes=0-99", SIZE), SIZE)).toBe(100);
  });

  test("an open-ended range runs to the last byte", () => {
    expect(parseRange("bytes=100-", SIZE)).toEqual({
      kind: "partial",
      range: { start: 100, end: 999 },
    });
  });

  test("a suffix range counts back from the end", () => {
    // bytes=-100 is the LAST 100 bytes, not the first 100.
    expect(parseRange("bytes=-100", SIZE)).toEqual({
      kind: "partial",
      range: { start: 900, end: 999 },
    });
  });

  test("an end past EOF is clamped rather than refused", () => {
    expect(parseRange("bytes=990-99999", SIZE)).toEqual({
      kind: "partial",
      range: { start: 990, end: 999 },
    });
  });

  test("a single trailing byte", () => {
    expect(parseRange("bytes=999-999", SIZE)).toEqual({
      kind: "partial",
      range: { start: 999, end: 999 },
    });
    expect(parseRange("bytes=-1", SIZE)).toEqual({
      kind: "partial",
      range: { start: 999, end: 999 },
    });
  });

  test("bytes=0-0 is one byte, not the whole object", () => {
    // Media players probe with this instead of a HEAD. Answering it with the
    // whole file would defeat the probe and cost the full egress.
    expect(parseRange("bytes=0-0", SIZE)).toEqual({
      kind: "partial",
      range: { start: 0, end: 0 },
    });
  });

  test("tolerates whitespace and case", () => {
    expect(parseRange("BYTES = 0-99", SIZE)).toEqual({
      kind: "partial",
      range: { start: 0, end: 99 },
    });
  });

  test("a start at or past EOF is unsatisfiable", () => {
    expect(parseRange("bytes=1000-", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=5000-6000", SIZE)).toEqual({
      kind: "unsatisfiable",
    });
  });

  test("an inverted range is unsatisfiable", () => {
    expect(parseRange("bytes=100-50", SIZE)).toEqual({
      kind: "unsatisfiable",
    });
  });

  test("a zero-length suffix is unsatisfiable", () => {
    expect(parseRange("bytes=-0", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  test("a malformed bytes spec is refused, not widened", () => {
    // Understood the unit, could not read the spec. Serving the entire object
    // to a client that asked for something incoherent is the worse answer.
    for (const header of ["bytes=abc", "bytes=-", "bytes=", "bytes=1-2-3"]) {
      expect(parseRange(header, SIZE)).toEqual({ kind: "unsatisfiable" });
    }
  });

  test("an unknown range unit is ignored", () => {
    // RFC 9110 §14.2 — not ours to answer, so serve the whole object.
    expect(parseRange("items=0-9", SIZE)).toEqual({ kind: "full" });
    expect(parseRange("0-99", SIZE)).toEqual({ kind: "full" });
  });

  test("a multi-range request is answered whole", () => {
    expect(parseRange("bytes=0-99,200-299", SIZE)).toEqual({ kind: "full" });
  });

  test("a zero-byte object satisfies no range at all", () => {
    expect(parseRange(null, 0)).toEqual({ kind: "full" });
    expect(parseRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=0-0", 0)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=-1", 0)).toEqual({ kind: "unsatisfiable" });
  });

  test("a one-byte object", () => {
    expect(parseRange("bytes=0-", 1)).toEqual({ kind: "full" });
    expect(parseRange("bytes=0-0", 1)).toEqual({ kind: "full" });
    expect(parseRange("bytes=1-", 1)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("contentRange", () => {
  test("names the slice and the total", () => {
    expect(contentRange({ start: 0, end: 99 }, SIZE)).toBe("bytes 0-99/1000");
  });

  test("the unsatisfiable form still tells the client the size", () => {
    // Without this a client that guessed wrong has nothing to correct against.
    expect(contentRange(null, SIZE)).toBe("bytes */1000");
  });
});

describe("rangeLength", () => {
  test("counts the bytes a verdict will put on the wire", () => {
    expect(rangeLength({ kind: "full" }, SIZE)).toBe(SIZE);
    expect(
      rangeLength({ kind: "partial", range: { start: 10, end: 19 } }, SIZE),
    ).toBe(10);
    expect(rangeLength({ kind: "unsatisfiable" }, SIZE)).toBe(0);
  });
});
