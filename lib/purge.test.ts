import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_RETENTION_DAYS,
  isPurgeDue,
  parseRetentionDays,
  purgeCutoff,
  purgeDueAt,
  retentionDays,
  retentionMs,
} from "./purge";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const original = process.env.TRASH_RETENTION_DAYS;

/** The window functions read the environment at call time, so pin it per test. */
function setRetention(value: string | undefined) {
  if (value === undefined) delete process.env.TRASH_RETENTION_DAYS;
  else process.env.TRASH_RETENTION_DAYS = value;
}

beforeEach(() => setRetention(undefined));
afterEach(() => setRetention(original));

describe("parseRetentionDays", () => {
  test("takes a plain number", () => {
    expect(parseRetentionDays("30")).toBe(30);
  });

  test("tolerates surrounding whitespace", () => {
    expect(parseRetentionDays("  14  ")).toBe(14);
  });

  test("accepts a fraction of a day", () => {
    expect(parseRetentionDays("0.5")).toBe(0.5);
  });

  test.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["not a number", "thirty"],
    ["zero", "0"],
    ["negative", "-7"],
    ["infinite", "Infinity"],
  ])(
    "falls back to the default when the value is %s",
    (_label, raw: string | undefined) => {
      expect(parseRetentionDays(raw)).toBe(DEFAULT_RETENTION_DAYS);
    },
  );

  test("a typo never throws — a file host must still boot", () => {
    expect(() => parseRetentionDays("7 days")).not.toThrow();
    expect(parseRetentionDays("7 days")).toBe(DEFAULT_RETENTION_DAYS);
  });
});

describe("retentionDays / retentionMs", () => {
  test("defaults to a week", () => {
    expect(retentionDays()).toBe(DEFAULT_RETENTION_DAYS);
    expect(retentionMs()).toBe(DEFAULT_RETENTION_DAYS * MS_PER_DAY);
  });

  test("follows the environment", () => {
    setRetention("30");

    expect(retentionDays()).toBe(30);
    expect(retentionMs()).toBe(30 * MS_PER_DAY);
  });
});

describe("purgeCutoff", () => {
  test("is one retention window behind the given clock", () => {
    setRetention("7");
    const now = new Date("2026-08-24T12:00:00.000Z");

    expect(purgeCutoff(now).toISOString()).toBe("2026-08-17T12:00:00.000Z");
  });

  test("moves with the configured window", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");

    setRetention("1");
    expect(purgeCutoff(now).toISOString()).toBe("2026-08-23T12:00:00.000Z");

    setRetention("30");
    expect(purgeCutoff(now).toISOString()).toBe("2026-07-25T12:00:00.000Z");
  });
});

describe("purgeDueAt", () => {
  test("is one retention window after the file was trashed", () => {
    setRetention("7");

    expect(purgeDueAt(new Date("2026-08-24T12:00:00.000Z")).toISOString()).toBe(
      "2026-08-31T12:00:00.000Z",
    );
  });

  test("agrees with purgeCutoff about the same file", () => {
    setRetention("7");
    const deletedAt = new Date("2026-08-24T12:00:00.000Z");
    const due = purgeDueAt(deletedAt);

    // At the instant it comes due, the cutoff has just reached it.
    expect(purgeCutoff(due).getTime()).toBe(deletedAt.getTime());
  });
});

describe("isPurgeDue", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");

  beforeEach(() => setRetention("7"));

  test("a live file is never due", () => {
    expect(isPurgeDue(null, now)).toBe(false);
  });

  test("a file trashed just now is not due", () => {
    expect(isPurgeDue(now, now)).toBe(false);
  });

  test("a file inside the window is not due", () => {
    const yesterday = new Date(now.getTime() - MS_PER_DAY);

    expect(isPurgeDue(yesterday, now)).toBe(false);
  });

  test("a file one millisecond short of the window is not due", () => {
    const almost = new Date(now.getTime() - 7 * MS_PER_DAY + 1);

    expect(isPurgeDue(almost, now)).toBe(false);
  });

  test("a file exactly at the window is due — the boundary is inclusive", () => {
    const exactly = new Date(now.getTime() - 7 * MS_PER_DAY);

    expect(isPurgeDue(exactly, now)).toBe(true);
  });

  test("a file well past the window is due", () => {
    const ancient = new Date(now.getTime() - 90 * MS_PER_DAY);

    expect(isPurgeDue(ancient, now)).toBe(true);
  });

  test("shortening the window makes previously safe files due", () => {
    const threeDaysAgo = new Date(now.getTime() - 3 * MS_PER_DAY);

    expect(isPurgeDue(threeDaysAgo, now)).toBe(false);

    setRetention("1");
    expect(isPurgeDue(threeDaysAgo, now)).toBe(true);
  });
});
