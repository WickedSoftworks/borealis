import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Terminal field. A solid ink caret on focus, dotted enclosure at rest — the
 * field looks like a place the cursor lands rather than a rounded box.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 border border-dotted border-ink-40 bg-transparent px-2.5 py-1",
        "font-mono text-[0.8125rem] text-ink-90 caret-[var(--ink-100)]",
        "placeholder:text-ink-60",
        "transition-colors outline-none",
        "focus-visible:border-solid focus-visible:border-ink-100 focus-visible:bg-ink-00/40",
        "aria-[invalid=true]:border-solid aria-[invalid=true]:border-ink-100",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "file:mr-2 file:border-0 file:bg-transparent file:text-ink-60",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
