import { describe, expect, test } from "bun:test";
import { generateKey } from "./e2e";
import { decodeKeyFragment, encodeKeyFragment } from "./fragment";

describe("key fragment", () => {
  test("round-trips several files", () => {
    const pairs = [
      { fileId: "clx1abc", key: "AAAA-BBBB_CCCC" },
      { fileId: "clx2def", key: "DDDD_EEEE-FFFF" },
    ];

    expect(decodeKeyFragment(encodeKeyFragment(pairs))).toEqual({
      clx1abc: "AAAA-BBBB_CCCC",
      clx2def: "DDDD_EEEE-FFFF",
    });
  });

  test("survives a real exported key", async () => {
    const { encoded } = await generateKey();
    const fragment = encodeKeyFragment([{ fileId: "clxreal", key: encoded }]);

    expect(decodeKeyFragment(fragment).clxreal).toBe(encoded);
  });

  test("accepts a hash with or without its leading marker", () => {
    const fragment = encodeKeyFragment([{ fileId: "a", key: "xyz" }]);

    expect(fragment.startsWith("#")).toBe(true);
    expect(decodeKeyFragment(fragment)).toEqual({ a: "xyz" });
    expect(decodeKeyFragment(fragment.slice(1))).toEqual({ a: "xyz" });
  });

  test("an empty list produces no fragment at all", () => {
    expect(encodeKeyFragment([])).toBe("");
  });

  test("ignores fragments that are not ours", () => {
    for (const hash of ["", "#", "#section-two", "#access_token=abc"]) {
      expect(decodeKeyFragment(hash)).toEqual({});
    }
  });

  test("drops malformed pairs rather than inventing empty keys", () => {
    expect(
      decodeKeyFragment("#k=noseparator~good.key~.leadingdot~trailing."),
    ).toEqual({
      good: "key",
    });
  });
});
