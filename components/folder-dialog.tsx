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

/**
 * Create a folder, or rename one.
 *
 * One component for both because they ask the same question and hit the same
 * uniqueness rule; splitting them would mean maintaining that error message
 * twice. Which one it is depends on whether a `folder` was passed.
 */
export function FolderDialog({
  folder,
  parentId = null,
  children,
}: {
  /** Present to rename an existing folder; absent to create a new one. */
  folder?: { id: string; name: string };
  /** Where a new folder lands. Ignored when renaming. */
  parentId?: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const fieldId = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(folder?.name ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopening after a failure should not present the previous attempt's error
  // alongside a field the user is about to retype.
  useEffect(() => {
    if (open) {
      setName(folder?.name ?? "");
      setError(null);
    }
  }, [open, folder?.name]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = folder
      ? await fetch(`/api/folders/${folder.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        })
      : await fetch("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, parentId }),
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
        title={folder ? "Rename folder" : "New folder"}
        description={
          folder
            ? undefined
            : "Folders organise your vault. They can be shared."
        }
        className="max-w-sm"
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId}>Name</Label>
            <Input
              id={fieldId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              autoFocus
              required
            />
          </div>

          {error && (
            <output className="block text-[0.75rem] leading-relaxed text-ink-90">
              {error}
            </output>
          )}

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
              disabled={pending || name.trim().length === 0}
            >
              {pending ? "…" : folder ? "Rename" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
