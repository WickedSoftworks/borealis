/**
 * The lightness ramp.
 *
 * Every tone in this interface is a glyph, not a shade: quiet values use sparse
 * characters, dense values use heavy ones. This is the single source of truth
 * for that mapping — meters, glyph text, and fills all sample from it.
 */
export const RAMP = [".", ":", "-", "=", "+", "*", "@"] as const;

export const RAMP_LABELS = [
  "quiet",
  "sparse",
  "low",
  "normal",
  "high",
  "dense",
  "full",
] as const;

/** Map 0..1 to a ramp glyph. */
export function glyphFor(intensity: number): string {
  if (!Number.isFinite(intensity)) return RAMP[0];

  const clamped = Math.min(1, Math.max(0, intensity));
  const index = Math.round(clamped * (RAMP.length - 1));

  return RAMP[index];
}

/** Ink opacity step matching a ramp position, so density and weight agree. */
export function inkClassFor(intensity: number): string {
  const clamped = Math.min(1, Math.max(0, intensity));

  if (clamped >= 0.86) return "text-ink-100";
  if (clamped >= 0.7) return "text-ink-90";
  if (clamped >= 0.52) return "text-ink-80";
  if (clamped >= 0.34) return "text-ink-60";
  if (clamped >= 0.18) return "text-ink-60";
  if (clamped > 0) return "text-ink-20";

  return "text-ink-00";
}
