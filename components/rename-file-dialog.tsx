"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/world/dialog";
import { Notice } from "@/components/world/notice";

/**
 * Rename a file. Modelled on the folder dialog, and like it the change is
 * immediate and visible to anyone holding a link to the file — which the
 * dialog says, because a name is often what a recipient reads first.
 */
export function RenameFileDialog({
  file,
  children,
}: {
  file: { id: string; originalName: string };
  children: React.ReactNode;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(file.originalName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(file.originalName);
      setError(null);
    }
  }, [open, file.originalName]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch(`/api/file/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    const body = await response.json().catch(() => null);
    setPending(false);

    if (!response.ok) {
      setError(body?.error ?? "That did not work.");
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        title="Rename file"
        description="The new name shows on every link carrying this file, straight away."
        className="max-w-sm"
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId}>Name</Label>
            <Input
              id={fieldId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={255}
              autoFocus
              required
              onFocus={(event) => {
                // Select the stem, not the extension — the usual thing to change.
                const dot = event.target.value.lastIndexOf(".");
                event.target.setSelectionRange(
                  0,
                  dot > 0 ? dot : event.target.value.length,
                );
              }}
            />
          </div>

          <Notice>{error}</Notice>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="quiet"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                pending || !name.trim() || name.trim() === file.originalName
              }
            >
              {pending ? "…" : "Rename"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
