import { RAMP } from "./ramp";

/**
 * Teaches the ramp once.
 *
 * Every meter in this interface is drawn from these seven characters, and a
 * first-time reader has no way to know that `@@@@@@....` is a quantity rather
 * than decoration. Stating the scale once turns the texture from ornament into
 * something readable.
 */
export function RampLegend({ className }: { className?: string }) {
  return (
    <div className={className}>
      <span className="text-[0.625rem] uppercase tracking-[0.22em] text-ink-60">
        Density scale
      </span>

      <div className="mt-1.5 flex items-baseline gap-3">
        <span
          aria-hidden="true"
          className="font-mono text-[0.8125rem] tracking-[0.28em] text-ink-80"
        >
          {RAMP.join("")}
        </span>

        <span className="text-[0.625rem] uppercase tracking-[0.16em] text-ink-60">
          quiet → full
        </span>
      </div>

      <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-ink-60">
        Meters are drawn from this scale, densest first. The figure beside every
        meter says the same thing in numbers.
      </p>
    </div>
  );
}
