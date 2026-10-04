import { describe, expect, test } from "bun:test";
import { withheldReason } from "./withheld";

describe("withheldReason", () => {
  test("a flagged file is withheld whether or not a scanner is running now", () => {
    expect(withheldReason({ scanStatus: "INFECTED" }, true)).toBe("INFECTED");
    expect(withheldReason({ scanStatus: "INFECTED" }, false)).toBe("INFECTED");
  });

  test("with a scanner, a file waits for its verdict", () => {
    expect(withheldReason({ scanStatus: null }, true)).toBe("UNSCANNED");
    expect(withheldReason({ scanStatus: "FAILED" }, true)).toBe("UNSCANNED");
  });

  test("a verdict, or a recorded reason there could be none, lets it go", () => {
    expect(withheldReason({ scanStatus: "CLEAN" }, true)).toBeNull();
    expect(withheldReason({ scanStatus: "SKIPPED" }, true)).toBeNull();
  });

  test("without a scanner nothing is pending", () => {
    expect(withheldReason({ scanStatus: null }, false)).toBeNull();
    expect(withheldReason({ scanStatus: "FAILED" }, false)).toBeNull();
  });
});
