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
        "text-[13.5px] font-medium text-fg select-none",
        "peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
