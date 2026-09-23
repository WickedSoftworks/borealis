import { describe, expect, test } from "bun:test";
import {
  activityWhere,
  csvField,
  csvRow,
  parseActivityFilters,
} from "./activity";

const parse = (query: string) => {
  const params = new URLSearchParams(query);
  return parseActivityFilters((name) => params.get(name));
};

describe("parseActivityFilters", () => {
  test("reads a full filter", () => {
    expect(
      parse("share=s1&action=UNLOCK_FAIL&from=2026-09-01&to=2026-09-30&page=3"),
    ).toEqual({
      shareId: "s1",
      action: "UNLOCK_FAIL",
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-30T23:59:59.999Z"),
      page: 3,
    });
  });

  test("an unknown action or a bad date is ignored", () => {
    const filters = parse("action=DELETE_EVERYTHING&from=yesterday&page=0");
    expect(filters.action).toBeNull();
    expect(filters.from).toBeNull();
    expect(filters.page).toBe(1);
  });
});

describe("activityWhere", () => {
  test("is always scoped to the owner's links", () => {
    expect(activityWhere("u1", parse(""))).toEqual({
      share: { ownerId: "u1" },
    });
  });
});

describe("csv", () => {
  test("quotes what needs quoting", () => {
    expect(csvField('a "quoted", value')).toBe('"a ""quoted"", value"');
    expect(csvField("plain")).toBe("plain");
    expect(csvField(null)).toBe("");
  });

  test("defuses spreadsheet formulas in uploader-chosen names", () => {
    expect(csvField('=HYPERLINK("http://evil")')).toBe(
      '"\'=HYPERLINK(""http://evil"")"',
    );
    expect(csvField("+cmd")).toBe("'+cmd");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  test("rows end in CRLF, as RFC 4180 asks", () => {
    expect(csvRow(["a", 1, null])).toBe("a,1,\r\n");
  });
});
