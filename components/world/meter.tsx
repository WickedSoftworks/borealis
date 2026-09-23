import { cn } from "@/lib/utils";
import { RAMP } from "./ramp";

/**
 * A quantity drawn as glyph density.
 *
 * Cells below the value fill with the dense end of the ramp and cells above it
 * stay at the quiet end, so the bar reads as texture rather than as a coloured
 * rectangle. The numeric value always ships alongside it — density is never the
 * only signal, which is what keeps this legible to a screen reader and to
 * anyone who cannot separate the two ends of the ramp by sight.
 */
export function DensityMeter({
  value,
  max,
  cells = 24,
  label,
  readout,
  tone = "normal",
  className,
}: {
  value: number;
  max: number;
  cells?: number;
  label: string;
  /** Human text for the value, e.g. "1.2 GB of 5 GB". Announced, and shown. */
  readout: string;
  tone?: "normal" | "alarm";
  className?: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

  // Any real usage must show at least one dense cell. Rounding a 1.7% ratio to
  // zero draws an untouched meter over a share that has already been fetched,
  // which is the one thing this control must never misreport.
  const filled = ratio > 0 ? Math.max(1, Math.round(ratio * cells)) : 0;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[0.6875rem] uppercase tracking-[0.18em] text-ink-60">
          {label}
        </span>
        <span
          className={cn(
            "text-[0.8125rem] tabular-nums",
            tone === "alarm" ? "text-ink-100" : "text-ink-80",
          )}
        >
          {readout}
        </span>
      </div>

      {/*
        Decorative. The label and readout above are real text carrying the same
        value, so the glyph row adds texture without adding a second thing for a
        screen reader to read out.
      */}
      <div
        aria-hidden="true"
        className={cn(
          "font-mono text-[0.8125rem] leading-none tracking-[0.1em] break-all",
          tone === "alarm" ? "text-ink-100" : "text-ink-80",
        )}
      >
        {Array.from({ length: cells }, (_, index) =>
          index < filled ? RAMP[RAMP.length - 1] : RAMP[0],
        ).join("")}
      </div>
    </div>
  );
}
