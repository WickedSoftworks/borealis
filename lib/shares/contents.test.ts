import { describe, expect, test } from "bun:test";
import type { FolderRow } from "@/lib/folders";
import { expandSharedFolders } from "./contents";

function folder(id: string, parentId: string | null = null): FolderRow {
  return {
    id,
    name: id,
    parentId,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/**
 *   projects
 *   ├── 2024
 *   │   └── raw
 *   └── archive
 *   invoices        (a separate root, never shared)
 */
const LIVE: FolderRow[] = [
  folder("projects"),
  folder("2024", "projects"),
  folder("raw", "2024"),
  folder("archive", "projects"),
  folder("invoices"),
];

describe("expandSharedFolders", () => {
  test("sharing a folder reaches its whole subtree", () => {
    const { allowedFolderIds } = expandSharedFolders(LIVE, ["projects"]);

    expect(allowedFolderIds.sort()).toEqual([
      "2024",
      "archive",
      "projects",
      "raw",
    ]);
  });

  test("a sibling branch is never reached", () => {
    const { allowedFolderIds } = expandSharedFolders(LIVE, ["2024"]);

    expect(allowedFolderIds).not.toContain("invoices");
    expect(allowedFolderIds).not.toContain("archive");
    expect(allowedFolderIds.sort()).toEqual(["2024", "raw"]);
  });

  test("a trashed folder contributes nothing, not even its children", () => {
    // The trashed folder is absent from the live rows. Its subtree must not
    // leak through a link that still names it — including `raw`, which is
    // itself still live but only reachable through the trashed parent.
    const withoutBranch = LIVE.filter((row) => row.id !== "2024");
    const { rootFolderIds, allowedFolderIds } = expandSharedFolders(
      withoutBranch,
      ["2024"],
    );

    expect(rootFolderIds).toEqual([]);
    expect(allowedFolderIds).toEqual([]);
  });

  test("a folder the owner does not have is ignored", () => {
    // Someone else's id, or one that never existed: absent either way, so a
    // forged ShareItem row cannot widen the share across accounts.
    expect(expandSharedFolders(LIVE, ["someone-elses"])).toEqual({
      rootFolderIds: [],
      allowedFolderIds: [],
    });
  });

  test("no folders shared means no folders reached", () => {
    expect(expandSharedFolders(LIVE, [])).toEqual({
      rootFolderIds: [],
      allowedFolderIds: [],
    });
  });

  test("overlapping shared folders are not double-counted", () => {
    const { allowedFolderIds } = expandSharedFolders(LIVE, [
      "projects",
      "2024",
    ]);

    expect(new Set(allowedFolderIds).size).toBe(allowedFolderIds.length);
  });

  test("a cyclic tree terminates instead of hanging", () => {
    const cyclic: FolderRow[] = [folder("x", "y"), folder("y", "x")];

    expect(expandSharedFolders(cyclic, ["x"]).allowedFolderIds.sort()).toEqual([
      "x",
      "y",
    ]);
  });
});
