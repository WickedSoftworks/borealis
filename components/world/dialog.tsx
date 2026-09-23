"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { IconClose } from "@/components/world/icons";
import { cn } from "@/lib/utils";

/**
 * A dialog rendered as a terminal window: hard edges, a dotted enclosure, and a
 * titled header rail matching Panel. No blur, no rounding, no drop shadow — the
 * ground simply darkens behind it and the panel sits on the same cell grid.
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70" />

      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
          "max-h-[calc(100vh-2rem)] overflow-y-auto border border-ink-40 bg-ground",
          className,
        )}
        {...props}
      >
        <header className="flex items-start justify-between gap-3 border-b border-dotted border-ink-20 px-4 py-3">
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="text-[0.6875rem] uppercase tracking-[0.22em] text-ink-90">
              {title}
            </DialogPrimitive.Title>

            {description && (
              <DialogPrimitive.Description className="text-[0.75rem] text-ink-60">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>

          <DialogPrimitive.Close
            className="text-ink-60 transition-colors hover:text-ink-100 focus-visible:text-ink-100"
            aria-label="Close"
          >
            <IconClose className="size-4" />
          </DialogPrimitive.Close>
        </header>

        <div className="p-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogTrigger, DialogContent, DialogClose };
