import { describe, expect, test } from "bun:test";
import {
  downloadEquivalent,
  downloadsExhausted,
  downloadsLeft,
  formatDownloads,
} from "./downloads";

describe("downloadEquivalent", () => {
  test("the whole file is one download", () => {
    expect(downloadEquivalent(1000n, 1000n)).toBe(1);
  });

  test("a range costs its fraction, so the pieces of a file add up to one", () => {
    const halves = [
      downloadEquivalent(500n, 1000n),
      downloadEquivalent(500n, 1000n),
    ];

    expect(halves).toEqual([0.5, 0.5]);
    expect(halves[0] + halves[1]).toBe(1);
  });

  test("an empty file still costs a download to fetch", () => {
    expect(downloadEquivalent(0n, 0n)).toBe(1);
  });
});

describe("downloadsExhausted", () => {
  test("uncapped never runs out", () => {
    expect(downloadsExhausted(1e6, null)).toBe(false);
  });

  test("a request may start while any of the cap is left", () => {
    expect(downloadsExhausted(2.5, 3)).toBe(false);
    expect(downloadsExhausted(3, 3)).toBe(true);
  });

  test("float rounding at the cap counts as spent", () => {
    // Three thirds of a file, as the counter really adds them.
    const used = 1 / 3 + 1 / 3 + 1 / 3 + 2;
    expect(downloadsExhausted(used, 3)).toBe(true);
  });
});

describe("formatting", () => {
  test("whole counts read as integers, parts as one decimal", () => {
    expect(formatDownloads(2)).toBe("2");
    expect(formatDownloads(1.5)).toBe("1.5");
  });

  test("never rounds up into a download that was not used", () => {
    expect(formatDownloads(2.96)).toBe("2.9");
    expect(formatDownloads(0.1 + 0.2)).toBe("0.3");
  });

  test("what is left is never negative", () => {
    expect(downloadsLeft(3.4, 3)).toBe(0);
    expect(downloadsLeft(1.5, 3)).toBe(1.5);
  });
});
