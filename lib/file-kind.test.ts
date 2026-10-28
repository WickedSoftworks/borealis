import { describe, expect, test } from "bun:test";
import { fileKind, fileKindLabel } from "./file-kind";

describe("fileKindLabel", () => {
  test("names the common types", () => {
    expect(fileKindLabel("application/pdf", "deck.pdf")).toBe("PDF");
    expect(
      fileKindLabel(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "contract.docx",
      ),
    ).toBe("Word document");
    expect(fileKindLabel("video/quicktime", "cut.mov")).toBe("Video");
  });

  test("falls back to the extension, then to a plain word", () => {
    expect(fileKindLabel("application/octet-stream", "backup.sqlite")).toBe(
      "File",
    );
    expect(fileKindLabel("application/octet-stream", "model.stl")).toBe(
      "STL file",
    );
    expect(fileKindLabel("application/octet-stream", "README")).toBe("File");
  });
});

describe("fileKind", () => {
  test("groups by what it is for", () => {
    expect(fileKind("image/png")).toBe("image");
    expect(fileKind("application/zip")).toBe("archive");
    expect(fileKind("application/x-unknown")).toBe("other");
  });
});
