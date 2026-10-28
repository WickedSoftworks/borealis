import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A field on the paper surface. The edge clears 3:1 against both grounds so
 * the box is findable without focus; 16px text on phones keeps iOS from
 * zooming the page when it is tapped.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-field-edge bg-paper px-3",
        "text-base text-fg sm:text-sm",
        "placeholder:text-fg-subtle",
        "transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        "aria-[invalid=true]:border-danger",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:mr-2 file:border-0 file:bg-transparent file:text-fg-subtle",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
