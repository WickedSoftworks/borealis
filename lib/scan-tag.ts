import type { ScanRules } from "@/lib/shares/withheld";

export type ScanTag = {
  label: string;
  tone: "quiet" | "alarm" | "danger";
  /** What it means for links, shown on hover. */
  reason: string;
};

/**
 * The scan state of one of your own files, as a tag for the vault list —
 * including what it means for the links that carry it, which depends on
 * what this instance lets through.
 *
 * Nothing for a clean file, or on an instance with no scanner: a tag on every
 * row would be noise. Nothing for a skipped encrypted file either; the row
 * already says it is end-to-end encrypted, and that is the whole reason. The
 * signature name of a flagged file stays with the operator, as elsewhere.
 */
export function scanTag(
  file: {
    scanStatus: string | null;
    scanDetail?: string | null;
    isEncrypted: boolean;
  },
  rules: ScanRules,
): ScanTag | null {
  const pending =
    rules.unscanned === "allow"
      ? "Links serve it already, marked as not scanned."
      : "Links hold it back until the scan finishes, usually in seconds.";

  switch (file.scanStatus) {
    case "INFECTED":
      return {
        label: "Flagged by scanner",
        tone: "danger",
        reason:
          rules.infected === "allow"
            ? "This instance still serves it through links, with a warning to the recipient."
            : "Withheld from every link. You can still download or delete it.",
      };
    case "SKIPPED":
      return file.isEncrypted
        ? null
        : {
            label: "Not scanned",
            tone: "quiet",
            reason: file.scanDetail ?? "The scanner skipped it.",
          };
    case "FAILED":
      return rules.scanning
        ? {
            label: "Scan failed",
            tone: "alarm",
            reason: `The scan will be tried again. ${pending}`,
          }
        : null;
    case null:
      return rules.scanning
        ? { label: "Scan pending", tone: "quiet", reason: pending }
        : null;
    default:
      return null;
  }
}
