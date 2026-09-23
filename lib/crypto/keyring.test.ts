import { beforeEach, describe, expect, test } from "bun:test";

// The keyring reads `window.localStorage` lazily inside each call, so a stub
// installed before the first call is enough — no DOM needed.
const store = new Map<string, string>();

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  },
});

const { forgetKey, partitionByKey, recallKey, rememberKey } = await import(
  "./keyring"
);

beforeEach(() => {
  store.clear();
});

describe("keyring", () => {
  test("remembers and recalls a key", () => {
    rememberKey("file-a", "key-a");
    expect(recallKey("file-a")).toBe("key-a");
  });

  test("an unknown file has no key rather than an empty one", () => {
    expect(recallKey("never-seen")).toBeNull();
  });

  test("keys accumulate instead of overwriting the ring", () => {
    rememberKey("file-a", "key-a");
    rememberKey("file-b", "key-b");

    expect(recallKey("file-a")).toBe("key-a");
    expect(recallKey("file-b")).toBe("key-b");
  });

  test("re-uploading a file id replaces its key", () => {
    rememberKey("file-a", "old");
    rememberKey("file-a", "new");

    expect(recallKey("file-a")).toBe("new");
  });

  test("forgetting one key leaves the others", () => {
    rememberKey("file-a", "key-a");
    rememberKey("file-b", "key-b");
    forgetKey("file-a");

    expect(recallKey("file-a")).toBeNull();
    expect(recallKey("file-b")).toBe("key-b");
  });

  test("partitions files into what this browser can and cannot open", () => {
    rememberKey("file-a", "key-a");
    rememberKey("file-c", "key-c");

    expect(partitionByKey(["file-a", "file-b", "file-c"])).toEqual({
      known: [
        { fileId: "file-a", key: "key-a" },
        { fileId: "file-c", key: "key-c" },
      ],
      missing: ["file-b"],
    });
  });

  test("a corrupt ring degrades to empty rather than throwing", () => {
    store.set("borealis.keys.v1", "{not json");

    expect(recallKey("file-a")).toBeNull();
    expect(partitionByKey(["file-a"])).toEqual({
      known: [],
      missing: ["file-a"],
    });
  });

  test("writing over a corrupt ring recovers it", () => {
    store.set("borealis.keys.v1", "{not json");
    rememberKey("file-a", "key-a");

    expect(recallKey("file-a")).toBe("key-a");
  });
});
