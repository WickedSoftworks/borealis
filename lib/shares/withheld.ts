/**
 * Why a file may not leave through a public link, if it may not.
 *
 *   INFECTED   the scanner recognised it
 *   UNSCANNED  a scanner is configured and has not had its turn yet — the
 *              upload is minutes old, or the scanner was down
 *
 * With a scanner configured, a file goes out only once it has a verdict:
 * CLEAN, or SKIPPED with a recorded reason (encrypted, larger than the
 * scanner takes). Withholding only INFECTED files meant every upload was
 * served in the window before its scan ran, and indefinitely if the scan
 * failed. Without a scanner nothing is pending, and only a verdict someone
 * recorded earlier can withhold.
 *
 * Pure, so the share page and the byte routes cannot disagree.
 */
export type Withheld = "INFECTED" | "UNSCANNED";

export function withheldReason(
  file: { scanStatus: string | null },
  scanning: boolean,
): Withheld | null {
  if (file.scanStatus === "INFECTED") return "INFECTED";
  if (!scanning) return null;
  if (file.scanStatus === "CLEAN" || file.scanStatus === "SKIPPED") return null;

  return "UNSCANNED";
}
