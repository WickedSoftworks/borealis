import { describe, expect, test } from "bun:test";
import {
  clip,
  escapeMarkdown,
  type LinkSummary,
  linkChoiceName,
  linkLine,
  linksMessage,
} from "./format";

const now = Date.UTC(2026, 9, 28, 12);
const day = 24 * 60 * 60 * 1000;

const link = (patch: Partial<LinkSummary> = {}): LinkSummary => ({
  id: "s1",
  kind: "SEND",
  name: "Masters for review",
  url: "https://example.test/s/abc",
  expiresAt: new Date(now + 6 * day),
  maxDownloads: 3,
  downloadCount: 1,
  egressLimitBytes: null,
  egressUsedBytes: 0,
  hasPassword: true,
  fileCount: 2,
  maxUploadFiles: null,
  ...patch,
});

describe("escapeMarkdown", () => {
  test("shows formatting characters as themselves", () => {
    expect(escapeMarkdown("**urgent** _now_")).toBe(
      "\\*\\*urgent\\*\\* \\_now\\_",
    );
  });
});

describe("linkLine", () => {
  test("names the link, says where it stands, and gives the URL", () => {
    expect(linkLine(link(), now)).toBe(
      "**Masters for review** · 1 of 3 downloads · 6d left · password\n<https://example.test/s/abc>",
    );
  });

  test("flags a link whose next download is its last", () => {
    expect(linkLine(link({ downloadCount: 2 }), now)).toContain(
      "near its limit",
    );
  });

  test("says ended once the downloads are spent", () => {
    expect(linkLine(link({ downloadCount: 3 }), now)).toContain("ended");
  });

  test("describes a collection link by what it has received", () => {
    const line = linkLine(
      link({
        kind: "REVERSE",
        name: null,
        maxUploadFiles: 20,
        fileCount: 4,
        hasPassword: false,
        expiresAt: null,
      }),
      now,
    );
    expect(line).toContain("**Untitled collection link**");
    expect(line).toContain("4 of 20 received");
    expect(line).toContain("no end date");
  });
});

describe("linksMessage", () => {
  test("points somewhere useful when there is nothing", () => {
    expect(linksMessage([], now)).toContain("/send");
  });

  test("stays within Discord's 2000 characters and says what it left out", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      link({ id: `s${index}`, name: `Link number ${index} `.repeat(4) }),
    );
    const message = linksMessage(many, now);
    expect(message.length).toBeLessThanOrEqual(2000);
    expect(message).toMatch(/…and \d+ more/);
  });
});

describe("linkChoiceName and clip", () => {
  test("fit Discord's 100-character choice names", () => {
    expect(linkChoiceName(link({ name: "x".repeat(300) }), now).length).toBe(
      100,
    );
    expect(clip("short", 100)).toBe("short");
  });
});
