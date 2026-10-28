import { describe, expect, test } from "bun:test";
import { nearLimit } from "./attention";

const open = {
  maxDownloads: null,
  downloadCount: 0,
  egressLimitBytes: null,
  egressUsedBytes: 0,
};

describe("nearLimit", () => {
  test("an uncapped link is never near a limit", () => {
    expect(
      nearLimit({ ...open, downloadCount: 500, egressUsedBytes: 1e12 }),
    ).toBe(false);
  });

  test("the next download being the last one counts", () => {
    expect(nearLimit({ ...open, maxDownloads: 3, downloadCount: 1 })).toBe(
      false,
    );
    expect(nearLimit({ ...open, maxDownloads: 3, downloadCount: 2 })).toBe(
      true,
    );
  });

  test("a partly fetched download still counts toward the last one", () => {
    expect(nearLimit({ ...open, maxDownloads: 3, downloadCount: 2.4 })).toBe(
      true,
    );
  });

  test("a spent link has ended, it is not near anything", () => {
    expect(nearLimit({ ...open, maxDownloads: 3, downloadCount: 3 })).toBe(
      false,
    );
  });

  test("a one-download link is not flagged before its one download", () => {
    expect(nearLimit({ ...open, maxDownloads: 1, downloadCount: 0 })).toBe(
      false,
    );
  });

  test("most of a transfer cap gone counts", () => {
    expect(
      nearLimit({ ...open, egressLimitBytes: 1000, egressUsedBytes: 799 }),
    ).toBe(false);
    expect(
      nearLimit({ ...open, egressLimitBytes: 1000, egressUsedBytes: 800 }),
    ).toBe(true);
  });
});
