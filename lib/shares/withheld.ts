import type { ScanPolicy } from "@/lib/settings";

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
 * An operator may relax either rule (`[scan]` in config.toml, or Admin →
 * Settings). A file let through that way is still marked — see `scanCaution`
 * — so the recipient is told what they are taking.
 *
 * Pure, so the share page and the byte routes cannot disagree.
 */
export type Withheld = "INFECTED" | "UNSCANNED";

export type ScanRules = {
  /** Whether a scanner is configured now. */
  scanning: boolean;
  infected: ScanPolicy;
  unscanned: ScanPolicy;
};

/**
 * What a file's scan state is, before any policy is applied. UNSCANNED here
 * means "owed a scan", which is worth queueing even when policy serves it.
 */
export function scanConcern(
  file: { scanStatus: string | null },
  scanning: boolean,
): Withheld | null {
  if (file.scanStatus === "INFECTED") return "INFECTED";
  if (!scanning) return null;
  if (file.scanStatus === "CLEAN" || file.scanStatus === "SKIPPED") return null;

  return "UNSCANNED";
}

export function withheldReason(
  file: { scanStatus: string | null },
  rules: ScanRules,
): Withheld | null {
  const reason = scanConcern(file, rules.scanning);

  if (reason === "INFECTED" && rules.infected === "allow") return null;
  if (reason === "UNSCANNED" && rules.unscanned === "allow") return null;

  return reason;
}

/**
 * A file that is served although the scan raised a concern, because the
 * operator allowed it: the warning the recipient must see beside it.
 */
export function scanCaution(
  file: { scanStatus: string | null },
  rules: ScanRules,
): Withheld | null {
  const reason = scanConcern(file, rules.scanning);
  return reason !== null && withheldReason(file, rules) === null
    ? reason
    : null;
}
