import { describe, expect, test } from "bun:test";
import {
  COMPOSER_PRESETS,
  describeItems,
  describeLink,
  generatePassword,
  matchPreset,
} from "./composer";

const base = {
  files: 2,
  folders: 0,
  password: false,
  viewOnly: false,
  maxDownloads: null,
  capGb: null,
  ends: "Nov 4",
  encrypted: 0,
};

describe("matchPreset", () => {
  test("each preset's own rules select it", () => {
    for (const preset of COMPOSER_PRESETS) {
      expect(matchPreset(preset.rules)).toBe(preset.id);
    }
  });

  test("changing one rule falls back to custom", () => {
    const review = COMPOSER_PRESETS[1].rules;
    expect(matchPreset({ ...review, maxDownloads: 4 })).toBe("custom");
    expect(matchPreset({ ...review, expiry: "other" })).toBe("custom");
  });
});

describe("describeItems", () => {
  test("names one thing in the singular", () => {
    expect(describeItems(1, 0)).toBe("this file");
    expect(describeItems(0, 1)).toBe("this folder");
  });

  test("counts several", () => {
    expect(describeItems(3, 0)).toBe("these 3 files");
    expect(describeItems(2, 1)).toBe("these 2 files and 1 folder");
  });
});

describe("describeLink", () => {
  test("says who, how often, and until when", () => {
    expect(
      describeLink({ ...base, password: true, maxDownloads: 3, capGb: 15 }),
    ).toBe(
      "Anyone with this link and the password can download these 2 files up to 3 times, until Nov 4, or until 15 GB has been sent in total. After that, it stops working.",
    );
  });

  test("a single download reads as once", () => {
    expect(describeLink({ ...base, files: 1, maxDownloads: 1 })).toContain(
      "can download this file once, until Nov 4.",
    );
  });

  test("an unbounded link says nothing limits it", () => {
    expect(describeLink({ ...base, ends: null })).toBe(
      "Anyone with this link can download these 2 files any number of times, until you revoke it. Nothing limits this link but you.",
    );
  });

  test("preview-only links do not promise downloads", () => {
    const text = describeLink({ ...base, viewOnly: true, maxDownloads: 2 });
    expect(text).toContain("can view these 2 files in the browser");
    expect(text).not.toContain("times");
  });

  test("mentions encryption", () => {
    expect(describeLink({ ...base, encrypted: 2 })).toContain(
      "The files are encrypted",
    );
    expect(describeLink({ ...base, encrypted: 1 })).toContain(
      "1 of the files is encrypted",
    );
  });
});

describe("generatePassword", () => {
  test("is three groups of four unambiguous characters", () => {
    const password = generatePassword();
    expect(password).toMatch(
      /^[a-km-np-z2-9]{4}-[a-km-np-z2-9]{4}-[a-km-np-z2-9]{4}$/,
    );
  });

  test("rejects bytes that would bias the alphabet", () => {
    // 255 is above the largest multiple of the alphabet size, so it is skipped.
    let call = 0;
    const password = generatePassword((bytes) => {
      bytes.fill(call++ === 0 ? 255 : 0);
      return bytes;
    });
    expect(password).toBe("aaaa-aaaa-aaaa");
  });
});
