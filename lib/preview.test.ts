import { describe, expect, test } from "bun:test";
import { classifyPreview, MAX_PREVIEW_BYTES, previewable } from "./preview";

describe("classifyPreview", () => {
  test("every allowlisted type maps to its kind", () => {
    for (const mime of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/avif",
    ]) {
      expect(classifyPreview(mime)).toEqual({
        kind: "image",
        contentType: mime,
      });
    }

    expect(classifyPreview("application/pdf")?.kind).toBe("pdf");

    for (const mime of [
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/json",
      "application/xml",
    ]) {
      expect(classifyPreview(mime)?.kind).toBe("text");
    }
  });

  test("script-capable and unknown types are never previewable", () => {
    for (const mime of [
      "image/svg+xml",
      "text/html",
      "application/xhtml+xml",
      "text/javascript",
      "application/octet-stream",
      "",
    ]) {
      expect(classifyPreview(mime)).toBeNull();
    }
  });

  test("text is always served as plain text, whatever was stored", () => {
    expect(classifyPreview("application/json")?.contentType).toBe(
      "text/plain; charset=utf-8",
    );
    expect(classifyPreview("TEXT/PLAIN; charset=latin1")?.contentType).toBe(
      "text/plain; charset=utf-8",
    );
  });

  test("the returned type is never an un-allowlisted input", () => {
    const sent = classifyPreview("image/PNG")?.contentType;
    expect(sent).toBe("image/png");
  });
});

describe("previewable", () => {
  test("an encrypted file is never previewable", () => {
    expect(
      previewable({ mimeType: "image/png", isEncrypted: true, size: 10 }),
    ).toBeNull();
  });

  test("an oversized image or PDF is not offered", () => {
    expect(
      previewable({
        mimeType: "application/pdf",
        isEncrypted: false,
        size: MAX_PREVIEW_BYTES + 1,
      }),
    ).toBeNull();
  });

  test("an oversized text file still is — only its first slice is fetched", () => {
    expect(
      previewable({
        mimeType: "text/plain",
        isEncrypted: false,
        size: BigInt(MAX_PREVIEW_BYTES) * 10n,
      })?.kind,
    ).toBe("text");
  });
});
