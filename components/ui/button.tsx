import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * One filled action per view: `primary` carries the accent, everything else
 * stays on the neutral surfaces. Destructive actions get their own hue so
 * "Revoke" never looks like "Copy link".
 */
const buttonVariants = cva(
  // Disabled fades the whole control rather than restyling it, so its label
  // stays readable while plainly unavailable.
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium outline-none select-none transition-[background-color,border-color,color,scale] duration-150 enabled:active:scale-[0.96] motion-reduce:enabled:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent font-semibold text-on-accent hover:bg-accent-hover",
        default:
          "border border-line-strong bg-raised text-fg hover:border-field-edge hover:bg-line",
        quiet:
          "border border-line text-fg-muted hover:border-line-strong hover:text-fg",
        ghost: "text-fg-muted hover:bg-raised hover:text-fg",
        danger:
          "border border-danger/50 text-danger hover:border-danger hover:bg-danger-soft",
        "danger-solid":
          "bg-danger font-semibold text-on-danger hover:opacity-90",
        link: "link-quiet h-auto px-0",
      },
      size: {
        default: "h-9 px-3.5 text-sm",
        sm: "h-8 px-2.5 text-[13px]",
        lg: "h-11 px-5 text-[15px]",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Component = asChild ? Slot.Root : "button";

  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
