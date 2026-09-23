import { describe, expect, test } from "bun:test";
import { describeUserAgent } from "./user-agent";

describe("describeUserAgent", () => {
  test("names the browser and platform, not the version", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
      ),
    ).toBe("Firefox on Windows");

    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPhone");
  });

  test("Edge is not mistaken for the Chrome it claims to be", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
      ),
    ).toBe("Edge on Windows");
  });

  test("Chrome is not mistaken for the Safari it claims to be", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome on Android");
  });

  test("tools and blanks", () => {
    expect(describeUserAgent("curl/8.9.1")).toBe("curl");
    expect(describeUserAgent(null)).toBe("Unknown device");
    expect(describeUserAgent("")).toBe("Unknown device");
  });
});
