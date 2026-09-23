import { describe, expect, test } from "bun:test";
import { capWarnings, diffShareItems } from "./edit";

const set = (fileIds: string[], folderIds: string[]) => ({
  fileIds,
  folderIds,
});

describe("diffShareItems", () => {
  test("an absent list leaves that kind alone", () => {
    const diff = diffShareItems(set(["f1", "f2"], ["d1"]), {});

    expect(diff.changed).toBe(false);
    expect(diff.addFileIds).toEqual([]);
    expect(diff.removeFileIds).toEqual([]);
    expect(diff.addFolderIds).toEqual([]);
    expect(diff.removeFolderIds).toEqual([]);
    expect(diff.resulting).toEqual(set(["f1", "f2"], ["d1"]));
  });

  test("a present list fully replaces that kind", () => {
    const diff = diffShareItems(set(["f1", "f2"], ["d1"]), {
      fileIds: ["f2", "f3"],
    });

    expect(diff.addFileIds).toEqual(["f3"]);
    expect(diff.removeFileIds).toEqual(["f1"]);
    expect(diff.resulting.fileIds).toEqual(["f2", "f3"]);
    // Folders were absent, so they are untouched.
    expect(diff.resulting.folderIds).toEqual(["d1"]);
    expect(diff.changed).toBe(true);
  });

  test("replacing one kind does not disturb the other", () => {
    const diff = diffShareItems(set(["f1"], ["d1", "d2"]), { folderIds: [] });

    expect(diff.removeFolderIds).toEqual(["d1", "d2"]);
    expect(diff.resulting).toEqual(set(["f1"], []));
  });

  test("an unchanged list of the same ids in a different order is not a change", () => {
    const diff = diffShareItems(set(["f1", "f2"], []), {
      fileIds: ["f2", "f1"],
    });

    expect(diff.changed).toBe(false);
    expect(diff.addFileIds).toEqual([]);
    expect(diff.removeFileIds).toEqual([]);
  });

  test("duplicates in the request collapse", () => {
    const diff = diffShareItems(set([], []), { fileIds: ["f1", "f1", "f2"] });

    expect(diff.addFileIds).toEqual(["f1", "f2"]);
    expect(diff.resulting.fileIds).toEqual(["f1", "f2"]);
  });

  test("emptying both kinds is reported, not silently allowed", () => {
    const diff = diffShareItems(set(["f1"], ["d1"]), {
      fileIds: [],
      folderIds: [],
    });

    expect(diff.resulting).toEqual(set([], []));
    expect(diff.changed).toBe(true);
  });
});

describe("capWarnings", () => {
  const usage = { downloadCount: 3, egressUsedBytes: 500 };

  test("no caps in the patch means no warnings", () => {
    expect(capWarnings(usage, {})).toEqual([]);
  });

  test("a download cap at the current count would close the link", () => {
    // The guard refuses at downloadCount >= maxDownloads.
    expect(capWarnings(usage, { maxDownloads: 3 })).toEqual([
      { cap: "downloads", used: 3, limit: 3 },
    ]);
  });

  test("a download cap below the current count would close the link", () => {
    expect(capWarnings(usage, { maxDownloads: 1 })).toEqual([
      { cap: "downloads", used: 3, limit: 1 },
    ]);
  });

  test("a download cap above the current count is fine", () => {
    expect(capWarnings(usage, { maxDownloads: 4 })).toEqual([]);
  });

  test("clearing a cap is never a warning", () => {
    expect(
      capWarnings(usage, { maxDownloads: null, egressLimitBytes: null }),
    ).toEqual([]);
  });

  test("an egress cap at or below what has already been served would close the link", () => {
    expect(capWarnings(usage, { egressLimitBytes: 500 })).toEqual([
      { cap: "egress", used: 500, limit: 500 },
    ]);
    expect(capWarnings(usage, { egressLimitBytes: 400 })).toEqual([
      { cap: "egress", used: 500, limit: 400 },
    ]);
  });

  test("both caps can warn at once", () => {
    expect(
      capWarnings(usage, { maxDownloads: 2, egressLimitBytes: 100 }),
    ).toEqual([
      { cap: "downloads", used: 3, limit: 2 },
      { cap: "egress", used: 500, limit: 100 },
    ]);
  });

  test("an unused share warns about nothing", () => {
    expect(
      capWarnings(
        { downloadCount: 0, egressUsedBytes: 0 },
        { maxDownloads: 1, egressLimitBytes: 1 },
      ),
    ).toEqual([]);
  });
});
