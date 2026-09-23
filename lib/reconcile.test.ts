import { describe, expect, test } from "bun:test";
import { classifyKey } from "./reconcile";

const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("classifyKey", () => {
  test("recognises an owner's upload and its tus sidecars", () => {
    for (const suffix of ["", ".json", ".info", ".part"]) {
      expect(classifyKey(`abc123XYZ_${uuid}${suffix}`)).toEqual({
        kind: "upload",
        base: `abc123XYZ_${uuid}`,
      });
    }
  });

  test("recognises root's uploads and collection-link uploads", () => {
    expect(classifyKey(`0_${uuid}`).kind).toBe("upload");
    expect(classifyKey(`reverse_${uuid}`)).toEqual({
      kind: "upload",
      base: `reverse_${uuid}`,
    });
  });

  test("recognises thumbnails", () => {
    expect(classifyKey("thumb_clxyz123.webp")).toEqual({ kind: "thumbnail" });
  });

  test("everything else is foreign and never touched", () => {
    for (const key of [
      "notes.txt",
      "backup.tar.gz",
      `${uuid}`,
      `abc_${uuid}.bak`,
      "thumb_../../etc.webp",
      ".DS_Store",
    ]) {
      expect(classifyKey(key)).toEqual({ kind: "foreign" });
    }
  });
});
