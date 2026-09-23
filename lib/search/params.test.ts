import { describe, expect, test } from "bun:test";
import { hasCriteria, parseSearchParams, typeFilter } from "./params";

const parse = (query: string) => parseSearchParams(new URLSearchParams(query));

describe("parseSearchParams", () => {
  test("reads every filter", () => {
    const params = parse(
      "q=invoice&type=document&folder=f1&from=2026-01-01&to=2026-01-31&min=1024&max=2048&sort=newest&offset=25",
    );

    expect(params).toEqual({
      text: "invoice",
      type: "document",
      folderId: "f1",
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-01-31T23:59:59.999Z"),
      minBytes: 1024n,
      maxBytes: 2048n,
      sort: "newest",
      offset: 25,
      limit: 25,
    });
  });

  test("a bare date covers the whole of that day", () => {
    const params = parse("from=2026-03-05&to=2026-03-05");
    expect((params.to?.getTime() ?? 0) - (params.from?.getTime() ?? 0)).toBe(
      86_400_000 - 1,
    );
  });

  test("bad values are dropped, not fatal", () => {
    const params = parse(
      "type=spaceship&from=2026-13-45&min=-5&max=lots&sort=chaos&offset=-3",
    );

    expect(params.type).toBeNull();
    expect(params.from).toBeNull();
    expect(params.minBytes).toBeNull();
    expect(params.maxBytes).toBeNull();
    expect(params.sort).toBe("relevance");
    expect(params.offset).toBe(0);
  });

  test("an absurd offset is clamped", () => {
    expect(parse("offset=99999999").offset).toBe(10_000);
  });
});

describe("hasCriteria", () => {
  test("one character of text is not worth a scan", () => {
    expect(hasCriteria(parse("q=a"))).toBe(false);
    expect(hasCriteria(parse("q=ab"))).toBe(true);
  });

  test("a filter alone is enough", () => {
    expect(hasCriteria(parse("type=image"))).toBe(true);
    expect(hasCriteria(parse(""))).toBe(false);
  });
});

describe("typeFilter", () => {
  test("images are a prefix match", () => {
    expect(typeFilter("image")).toEqual({
      OR: [{ mimeType: { startsWith: "image/" } }],
    });
  });

  test("archives are an exact list", () => {
    const filter = typeFilter("archive");
    expect(filter.OR).toHaveLength(1);
    expect(JSON.stringify(filter)).toContain("application/zip");
  });
});
