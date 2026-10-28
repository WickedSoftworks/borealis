import { cn } from "@/lib/utils";

/**
 * A quantity as a thin bar with its figure beside it.
 *
 * The readout is the real information and is what a screen reader hears; the
 * bar repeats it for a glance. `alarm` switches both to the warning colour as
 * a limit nears — the readout's words still say how near.
 */
export function DensityMeter({
  value,
  max,
  label,
  readout,
  tone = "normal",
  unbounded = false,
  className,
}: {
  value: number;
  max: number;
  /** No limit to measure against: drawn as an open dashed line. */
  unbounded?: boolean;
  /** Ignored; kept so existing callers need not change. */
  cells?: number;
  label: string;
  /** Human text for the value, e.g. "1.2 GB of 5 GB". Announced, and shown. */
  readout: string;
  tone?: "normal" | "alarm";
  className?: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

  // Any real usage must show some fill. A 0.4% ratio rounded to nothing draws
  // an untouched bar over a share that has already been fetched, which is the
  // one thing this control must never misreport.
  const percent = ratio > 0 ? Math.max(2, ratio * 100) : 0;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-fg-subtle">{label}</span>
        <span
          className={cn(
            "data text-[12.5px]",
            tone === "alarm" ? "text-warn" : "text-fg-muted",
          )}
        >
          {readout}
        </span>
      </div>

      {unbounded ? (
        <span
          aria-hidden="true"
          className="mt-[1.5px] block border-t border-dashed border-line-strong"
        />
      ) : (
        <span
          aria-hidden="true"
          className="block h-1 overflow-hidden rounded-full bg-line"
        >
          <span
            className={cn(
              "block h-full rounded-full",
              tone === "alarm" ? "bg-warn" : "bg-fg-subtle",
            )}
            style={{ width: `${percent}%` }}
          />
        </span>
      )}
    </div>
  );
}

/**
 * A transfer's progress, drawn in the aurora while it moves. Decorative: the
 * percentage and byte counts beside it are what get announced.
 */
export function ProgressBar({
  ratio,
  tone = "normal",
  className,
}: {
  ratio: number;
  tone?: "normal" | "danger";
  className?: string;
}) {
  const clamped = Math.min(1, Math.max(0, ratio));

  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-1 overflow-hidden rounded-full bg-line",
        className,
      )}
    >
      <span
        className={cn(
          "block h-full rounded-full transition-[width] duration-300",
          tone === "danger" ? "bg-danger" : "bg-[image:var(--aurora)]",
        )}
        style={{ width: `${clamped > 0 ? Math.max(2, clamped * 100) : 0}%` }}
      />
    </span>
  );
}
