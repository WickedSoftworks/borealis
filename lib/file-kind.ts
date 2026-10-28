/**
 * A file's kind in words, for the line under its name: "PDF", "Video".
 * Read from the MIME type the upload declared, falling back to the
 * extension, so it describes rather than vouches — nothing here is checked.
 */

export type FileKind =
  | "document"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "text"
  | "other";

const ARCHIVE_TYPES = [
  "application/zip",
  "application/x-tar",
  "application/gzip",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
];

export function fileKind(mimeType: string): FileKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (ARCHIVE_TYPES.includes(mimeType)) return "archive";
  if (mimeType.startsWith("text/")) return "text";
  if (
    mimeType === "application/pdf" ||
    mimeType.includes("officedocument") ||
    mimeType.includes("msword") ||
    mimeType.includes("opendocument") ||
    mimeType === "application/rtf"
  ) {
    return "document";
  }

  return "other";
}

const NAMED: Record<string, string> = {
  "application/pdf": "PDF",
  "text/plain": "Plain text",
  "text/markdown": "Markdown",
  "text/csv": "CSV",
};

export function fileKindLabel(mimeType: string, name: string): string {
  if (NAMED[mimeType]) return NAMED[mimeType];

  const kind = fileKind(mimeType);
  if (mimeType.includes("wordprocessingml") || mimeType.includes("msword")) {
    return "Word document";
  }
  if (mimeType.includes("spreadsheetml") || mimeType.includes("ms-excel")) {
    return "Spreadsheet";
  }
  if (mimeType.includes("presentationml") || mimeType.includes("powerpoint")) {
    return "Presentation";
  }
  if (kind !== "other" && kind !== "document") {
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  }

  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1)
    : "";
  return extension && extension.length <= 5
    ? `${extension.toUpperCase()} file`
    : "File";
}
