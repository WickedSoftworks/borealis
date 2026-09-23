import { describe, expect, test } from "bun:test";
import {
  buildTree,
  depthOf,
  descendantsOf,
  type FolderNode,
  heightOf,
  MAX_FOLDER_DEPTH,
  pathTo,
  wouldCycle,
} from "./folders";

/**
 *   a          e
 *   ├── b
 *   │   └── d
 *   └── c
 */
const TREE: FolderNode[] = [
  { id: "a", name: "a", parentId: null },
  { id: "b", name: "b", parentId: "a" },
  { id: "c", name: "c", parentId: "a" },
  { id: "d", name: "d", parentId: "b" },
  { id: "e", name: "e", parentId: null },
];

/** Two folders each claiming the other as parent. Nothing forbids this. */
const MUTUAL: FolderNode[] = [
  { id: "x", name: "x", parentId: "y" },
  { id: "y", name: "y", parentId: "x" },
];

/** A folder that is its own parent. Nothing forbids this either. */
const SELF: FolderNode[] = [{ id: "s", name: "s", parentId: "s" }];

function chain(length: number): FolderNode[] {
  return Array.from({ length }, (_, i) => ({
    id: `n${i}`,
    name: `n${i}`,
    parentId: i === 0 ? null : `n${i - 1}`,
  }));
}

describe("buildTree", () => {
  test("nests children under parents and sorts by name", () => {
    const roots = buildTree(TREE);

    expect(roots.map((node) => node.id)).toEqual(["a", "e"]);
    expect(roots[0].children.map((node) => node.id)).toEqual(["b", "c"]);
    expect(roots[0].children[0].children.map((node) => node.id)).toEqual(["d"]);
  });

  test("a folder whose parent is absent becomes a root, not a disappearance", () => {
    // The live-folders query filters out trashed rows, so a live child of a
    // trashed parent arrives here parentless. Dropping it would hide files.
    const orphaned = TREE.filter((node) => node.id !== "a");

    expect(buildTree(orphaned).map((node) => node.id)).toEqual(["b", "c", "e"]);
  });

  test("a self-parented folder still renders", () => {
    expect(buildTree(SELF).map((node) => node.id)).toEqual(["s"]);
  });

  test("mutually-parented folders do not vanish", () => {
    expect(buildTree(MUTUAL).length).toBeGreaterThan(0);
  });
});

describe("pathTo", () => {
  test("returns root-first ancestry, inclusive", () => {
    expect(pathTo(TREE, "d").map((node) => node.id)).toEqual(["a", "b", "d"]);
  });

  test("a root folder is its own whole path", () => {
    expect(pathTo(TREE, "e").map((node) => node.id)).toEqual(["e"]);
  });

  test("an unknown id has no path", () => {
    expect(pathTo(TREE, "nope")).toEqual([]);
  });

  test("a cycle terminates instead of hanging", () => {
    expect(pathTo(MUTUAL, "x").length).toBeLessThanOrEqual(2);
  });

  test("a chain deeper than the cap is truncated, not infinite", () => {
    expect(
      pathTo(chain(MAX_FOLDER_DEPTH + 5), `n${MAX_FOLDER_DEPTH + 4}`).length,
    ).toBe(MAX_FOLDER_DEPTH);
  });
});

describe("descendantsOf", () => {
  test("returns the subtree, excluding the folder itself", () => {
    expect(
      descendantsOf(TREE, "a")
        .map((node) => node.id)
        .sort(),
    ).toEqual(["b", "c", "d"]);
  });

  test("a leaf has none", () => {
    expect(descendantsOf(TREE, "d")).toEqual([]);
  });

  test("a self-parented folder is not its own descendant", () => {
    expect(descendantsOf(SELF, "s")).toEqual([]);
  });

  test("a cycle terminates", () => {
    expect(descendantsOf(MUTUAL, "x").map((node) => node.id)).toEqual(["y"]);
  });
});

describe("depthOf and heightOf", () => {
  test("a root folder is depth 1", () => {
    expect(depthOf(TREE, "a")).toBe(1);
  });

  test("depth counts the whole ancestry", () => {
    expect(depthOf(TREE, "d")).toBe(3);
  });

  test("a leaf has height 1", () => {
    expect(heightOf(TREE, "d")).toBe(1);
    expect(heightOf(TREE, "c")).toBe(1);
  });

  test("height counts the tallest branch below", () => {
    expect(heightOf(TREE, "a")).toBe(3);
    expect(heightOf(TREE, "b")).toBe(2);
  });

  test("an unknown folder has no height", () => {
    expect(heightOf(TREE, "nope")).toBe(0);
  });
});

describe("wouldCycle", () => {
  test("moving to the root is always allowed", () => {
    expect(wouldCycle(TREE, "b", null)).toBe(false);
  });

  test("moving between unrelated branches is allowed", () => {
    expect(wouldCycle(TREE, "b", "e")).toBe(false);
  });

  test("a folder cannot become its own parent", () => {
    expect(wouldCycle(TREE, "a", "a")).toBe(true);
  });

  test("a folder cannot move into its own child", () => {
    expect(wouldCycle(TREE, "a", "b")).toBe(true);
  });

  test("a folder cannot move into a deeper descendant", () => {
    // The detaching case: a, b and d would all still exist, owned by the same
    // account, and be unreachable from every root the UI can render.
    expect(wouldCycle(TREE, "a", "d")).toBe(true);
  });

  test("a move that would bust the depth cap is refused", () => {
    const rows = [
      ...chain(MAX_FOLDER_DEPTH - 1),
      { id: "tall", name: "tall", parentId: null },
      { id: "taller", name: "taller", parentId: "tall" },
      { id: "tallest", name: "tallest", parentId: "taller" },
    ];

    expect(wouldCycle(rows, "tall", `n${MAX_FOLDER_DEPTH - 2}`)).toBe(true);
  });

  test("an unknown destination is not treated as a cycle", () => {
    expect(wouldCycle(TREE, "b", "nope")).toBe(false);
  });
});
