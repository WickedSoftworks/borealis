"use client";

import { Label as LabelPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60 select-none",
        "peer-disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
