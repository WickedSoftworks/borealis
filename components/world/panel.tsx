import { cn } from "@/lib/utils";

/**
 * A titled surface for one subject. Used for the detail and settings blocks;
 * plain lists sit straight on the page, separated by hairlines, instead.
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
  /** Short right-aligned state in the header, e.g. a StateTag. */
  status?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn("rounded-xl border border-line bg-paper", className)}
    >
      {(title || status || actions) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2">
          {title && <h2 className="label-caps">{title}</h2>}

          <div className="ml-auto flex items-center gap-3">
            {status}
            {actions}
          </div>
        </header>
      )}

      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A label and its value on one line, the value right-aligned. */
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
        "flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0",
        className,
      )}
    >
      <span className="text-[13px] text-fg-subtle">{label}</span>
      <span className="text-right text-sm tabular-nums text-fg">
        {children}
      </span>
    </div>
  );
}

/**
 * A short state word. The word always carries the meaning; the colour only
 * repeats it, and each colour means one thing across the interface.
 */
export function StateTag({
  children,
  tone = "normal",
}: {
  children: React.ReactNode;
  tone?: "normal" | "quiet" | "alarm" | "active" | "danger" | "e2e";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-sm px-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]",
        tone === "normal" && "bg-raised text-fg-muted",
        tone === "quiet" && "border border-line text-fg-subtle",
        tone === "alarm" && "bg-warn-soft text-warn",
        tone === "active" && "bg-accent-soft text-accent",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "e2e" && "bg-e2e-soft text-e2e",
      )}
    >
      {children}
    </span>
  );
}
