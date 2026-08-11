import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Phosphor control. Rest is an outlined cell; active and primary invert to a
 * solid ink fill with the ground showing through the lettering, which is how
 * this world marks the selected thing.
 */
const buttonVariants = cva(
  // Disabled drops the fill entirely rather than fading it: a 40%-opacity ink
  // slab reads as a stock grey button on the paper register, where an empty
  // dotted cell still reads as "this control is here but not available".
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-mono uppercase tracking-[0.16em] transition-[background-color,color,border-color] duration-100 outline-none select-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:border disabled:border-dotted disabled:border-ink-20 disabled:bg-transparent disabled:text-ink-20 disabled:font-normal [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink-100 text-ground font-bold hover:bg-ink-90",
        default:
          "border border-ink-40 text-ink-80 hover:bg-ink-100 hover:text-ground hover:border-ink-100",
        quiet:
          "border border-dotted border-ink-20 text-ink-60 hover:text-ink-100 hover:border-ink-60",
        ghost: "text-ink-60 hover:text-ink-100 hover:bg-ink-00",
        link: "text-ink-80 underline underline-offset-4 hover:text-ink-100",
      },
      size: {
        default: "h-8 px-3 text-[0.6875rem]",
        sm: "h-7 px-2.5 text-[0.625rem]",
        lg: "h-10 px-5 text-[0.75rem]",
        icon: "size-8",
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
