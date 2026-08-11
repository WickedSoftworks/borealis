import { cn } from "@/lib/utils";

/**
 * The panel: a dotted hairline enclosure with a titled header rail.
 *
 * Panels never nest. A panel holds one subject; a second subject gets a second
 * panel on the same grid.
 */
export function Panel({
  title,
  status,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  /** Short right-aligned state word in the header rail, e.g. "SEALED". */
  status?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rule-dotted bg-ground-raised/40", className)}>
      {(title || status || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-dotted border-ink-20 px-3 py-2">
          {title && (
            <h2 className="text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
              {title}
            </h2>
          )}

          <div className="flex items-center gap-3">
            {status}
            {actions}
          </div>
        </header>
      )}

      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A label/value pair on the cell grid, values right-aligned and tabular. */
export function DataRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 border-b border-dotted border-ink-20 py-1.5 last:border-b-0",
        className,
      )}
    >
      <span className="text-[0.6875rem] uppercase tracking-[0.18em] text-ink-60">
        {label}
      </span>
      <span className="text-[0.8125rem] tabular-nums text-ink-80">
        {children}
      </span>
    </div>
  );
}

/**
 * A state word. `alarm` inverts the cell rather than changing hue — this is a
 * single-ink system, so emphasis is density and inversion, never a second
 * colour. The word itself always carries the meaning.
 */
export function StateTag({
  children,
  tone = "normal",
}: {
  children: React.ReactNode;
  tone?: "normal" | "quiet" | "alarm";
}) {
  return (
    <span
      className={cn(
        "px-1.5 py-0.5 text-[0.625rem] uppercase tracking-[0.18em] whitespace-nowrap",
        tone === "alarm" && "bg-ink-100 text-ground font-bold",
        tone === "normal" && "border border-ink-40 text-ink-80",
        tone === "quiet" && "border border-dotted border-ink-20 text-ink-60",
      )}
    >
      {children}
    </span>
  );
}
