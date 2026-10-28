import { describe, expect, test } from "bun:test";
import { scanTag } from "./scan-tag";
import type { ScanRules } from "./shares/withheld";

const rules: ScanRules = {
  scanning: true,
  infected: "withhold",
  unscanned: "withhold",
};
const file = (scanStatus: string | null, extra = {}) => ({
  scanStatus,
  isEncrypted: false,
  ...extra,
});

describe("scanTag", () => {
  test("says nothing about a clean file, or with no scanner", () => {
    expect(scanTag(file("CLEAN"), rules)).toBeNull();
    expect(scanTag(file(null), { ...rules, scanning: false })).toBeNull();
  });

  test("a file waiting for its scan says what links do meanwhile", () => {
    expect(scanTag(file(null), rules)).toMatchObject({
      label: "Scan pending",
      reason: expect.stringContaining("hold it back"),
    });
    expect(
      scanTag(file(null), { ...rules, unscanned: "allow" })?.reason,
    ).toContain("serve it already");
  });

  test("a flagged file says whether it is still shared", () => {
    expect(scanTag(file("INFECTED"), rules)).toMatchObject({
      label: "Flagged by scanner",
      tone: "danger",
      reason: expect.stringContaining("Withheld"),
    });
    expect(
      scanTag(file("INFECTED"), { ...rules, infected: "allow" })?.reason,
    ).toContain("still serves it");
  });

  test("a skipped file gives the scanner's reason, unless it is encrypted", () => {
    expect(
      scanTag(
        file("SKIPPED", { scanDetail: "larger than the scanner accepts" }),
        rules,
      ),
    ).toMatchObject({
      label: "Not scanned",
      reason: "larger than the scanner accepts",
    });
    expect(scanTag(file("SKIPPED", { isEncrypted: true }), rules)).toBeNull();
  });

  test("a failed scan is flagged for attention", () => {
    expect(scanTag(file("FAILED"), rules)?.tone).toBe("alarm");
  });
});
