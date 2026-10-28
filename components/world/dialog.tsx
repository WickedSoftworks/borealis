"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { IconClose } from "@/components/world/icons";
import { cn } from "@/lib/utils";

/**
 * A sheet of paper over a dimmed page. Radix supplies the focus trap, Escape
 * and focus return; scrolling past the end of a long dialog stays inside it.
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
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)]" />

      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
          "max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-line-strong bg-paper shadow-[var(--shadow-overlay)]",
          className,
        )}
        {...props}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 pb-4 pt-5">
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="font-serif text-[24px] font-medium leading-tight tracking-[-0.02em] text-fg">
              {title}
            </DialogPrimitive.Title>

            {description && (
              <DialogPrimitive.Description className="text-sm text-fg-subtle">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>

          <DialogPrimitive.Close
            className="-mr-1.5 grid size-9 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-raised hover:text-fg"
            aria-label="Close"
          >
            <IconClose className="size-4" />
          </DialogPrimitive.Close>
        </header>

        <div className="p-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogClose, DialogContent, DialogTrigger };
