import { describe, expect, test } from "bun:test";
import { isAbandoned } from "./tus-store";

const HOUR = 60 * 60 * 1000;
const now = Date.parse("2026-09-22T12:00:00Z");
const old = new Date(now - 48 * HOUR).toISOString();
const fresh = new Date(now - 1 * HOUR).toISOString();

const base = {
  info: { size: 1000, creation_date: old },
  bytesOnDisk: 400,
  recorded: false,
  now,
  expiryMs: 24 * HOUR,
};

describe("isAbandoned", () => {
  test("an old, unrecorded, half-written upload is abandoned", () => {
    expect(isAbandoned(base)).toBe(true);
  });

  /*
    The regression this module exists for. @tus/file-store's sidecar keeps
    `offset: 0` forever, so its own deleteExpired() judged every finished
    upload older than the window "incomplete" and deleted it. A complete file
    must survive on the bytes actually on disk alone.
  */
  test("a finished upload is never abandoned, however old", () => {
    expect(isAbandoned({ ...base, bytesOnDisk: 1000 })).toBe(false);
    expect(
      isAbandoned({
        ...base,
        info: { size: 1000, creation_date: new Date(0).toISOString() },
        bytesOnDisk: 1000,
      }),
    ).toBe(false);
  });

  test("anything a File row points at is never touched, even if short", () => {
    expect(isAbandoned({ ...base, recorded: true })).toBe(false);
  });

  test("an upload still inside its window is left to finish", () => {
    expect(
      isAbandoned({ ...base, info: { size: 1000, creation_date: fresh } }),
    ).toBe(false);
  });

  test("an upload with no declared size or date is not guessed about", () => {
    expect(isAbandoned({ ...base, info: { creation_date: old } })).toBe(false);
    expect(isAbandoned({ ...base, info: { size: 1000 } })).toBe(false);
    expect(
      isAbandoned({
        ...base,
        info: { size: 1000, creation_date: "not a date" },
      }),
    ).toBe(false);
  });

  test("a leftover sidecar whose data is gone is cleared", () => {
    expect(isAbandoned({ ...base, bytesOnDisk: null })).toBe(true);
  });
});
