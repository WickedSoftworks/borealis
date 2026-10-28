"use client";

import { cn } from "@/lib/utils";

/**
 * An on/off switch for a setting that takes effect as it is flipped. A real
 * button with role="switch", so it is reached by Tab and toggled by Space.
 */
export function Switch({
  checked,
  onCheckedChange,
  tone = "accent",
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange"> & {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** The encryption switch takes its own colour, as everywhere else. */
  tone?: "accent" | "e2e";
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group relative h-5 w-9 shrink-0 rounded-full bg-field-edge transition-colors",
        tone === "e2e" ? "aria-checked:bg-e2e" : "aria-checked:bg-accent",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="absolute left-0.5 top-0.5 size-4 rounded-full bg-fg transition-transform group-aria-checked:translate-x-4 group-aria-checked:bg-on-accent motion-reduce:transition-none"
      />
    </button>
  );
}
