import { describe, expect, test } from "bun:test";
import { type ScanRules, scanCaution, withheldReason } from "./withheld";

const strict = (scanning: boolean): ScanRules => ({
  scanning,
  infected: "withhold",
  unscanned: "withhold",
});

describe("withheldReason", () => {
  test("a flagged file is withheld whether or not a scanner is running now", () => {
    expect(withheldReason({ scanStatus: "INFECTED" }, strict(true))).toBe(
      "INFECTED",
    );
    expect(withheldReason({ scanStatus: "INFECTED" }, strict(false))).toBe(
      "INFECTED",
    );
  });

  test("with a scanner, a file waits for its verdict", () => {
    expect(withheldReason({ scanStatus: null }, strict(true))).toBe(
      "UNSCANNED",
    );
    expect(withheldReason({ scanStatus: "FAILED" }, strict(true))).toBe(
      "UNSCANNED",
    );
  });

  test("a verdict, or a recorded reason there could be none, lets it go", () => {
    expect(withheldReason({ scanStatus: "CLEAN" }, strict(true))).toBeNull();
    expect(withheldReason({ scanStatus: "SKIPPED" }, strict(true))).toBeNull();
  });

  test("without a scanner nothing is pending", () => {
    expect(withheldReason({ scanStatus: null }, strict(false))).toBeNull();
    expect(withheldReason({ scanStatus: "FAILED" }, strict(false))).toBeNull();
  });

  test("an operator can let each concern through on its own", () => {
    const allowInfected = { ...strict(true), infected: "allow" as const };
    expect(
      withheldReason({ scanStatus: "INFECTED" }, allowInfected),
    ).toBeNull();
    expect(withheldReason({ scanStatus: null }, allowInfected)).toBe(
      "UNSCANNED",
    );

    const allowUnscanned = { ...strict(true), unscanned: "allow" as const };
    expect(withheldReason({ scanStatus: null }, allowUnscanned)).toBeNull();
    expect(withheldReason({ scanStatus: "INFECTED" }, allowUnscanned)).toBe(
      "INFECTED",
    );
  });
});

describe("scanCaution", () => {
  test("marks exactly the files let through despite a concern", () => {
    const open: ScanRules = {
      scanning: true,
      infected: "allow",
      unscanned: "allow",
    };
    expect(scanCaution({ scanStatus: "INFECTED" }, open)).toBe("INFECTED");
    expect(scanCaution({ scanStatus: null }, open)).toBe("UNSCANNED");
    expect(scanCaution({ scanStatus: "CLEAN" }, open)).toBeNull();
  });

  test("a withheld file needs no caution: it is not served", () => {
    expect(scanCaution({ scanStatus: "INFECTED" }, strict(true))).toBeNull();
  });
});
