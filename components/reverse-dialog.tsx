"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ExpiryField } from "@/components/expiry-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/world/dialog";
import { IconCheck, IconUpload } from "@/components/world/icons";
import type { ExpiryInput } from "@/lib/shares/expiry";

/**
 * Composer for a link that collects instead of serving.
 *
 * A reverse share is the one surface where a stranger writes to the operator's
 * disk, so its two ceilings — how many files and how large — are ordinary
 * fields with real defaults rather than optional extras.
 */
export function ReverseDialog() {
  const router = useRouter();
  const formId = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expiry, setExpiry] = useState<ExpiryInput | null>({
    mode: "preset",
    preset: "1w",
  });
  const [maxFiles, setMaxFiles] = useState("20");
  const [maxUploadMb, setMaxUploadMb] = useState("");
  const [requireUploader, setRequireUploader] = useState(true);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const response = await fetch("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "REVERSE",
        name: name || undefined,
        description: description || undefined,
        // Never null here: "Keep current" only exists when editing.
        expiry: expiry ?? undefined,
        maxUploadFiles: maxFiles ? Number(maxFiles) : null,
        maxUploadMb: maxUploadMb ? Number(maxUploadMb) : null,
        requireUploader,
      }),
    });

    setPending(false);
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setError(body?.error ?? "Could not create the link.");
      return;
    }

    setCreatedUrl(`${window.location.origin}${body.url}`);
    router.refresh();
  }

  function reset() {
    setCreatedUrl(null);
    setCopied(false);
    setName("");
    setDescription("");
    setMaxFiles("20");
    setMaxUploadMb("");
    setRequireUploader(true);
    setError(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="quiet" size="sm">
          <IconUpload className="size-3.5" />
          Collect files
        </Button>
      </DialogTrigger>

      <DialogContent
        title={createdUrl ? "Link ready" : "Collect files"}
        description={
          createdUrl
            ? undefined
            : "A link anyone can send files through. They land in your vault; they never see what is already there."
        }
      >
        {createdUrl ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${formId}-url`}>Link</Label>
              <div className="flex gap-2">
                <Input id={`${formId}-url`} readOnly value={createdUrl} />
                <Button
                  type="button"
                  variant="primary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(createdUrl);
                    setCopied(true);
                  }}
                >
                  {copied ? <IconCheck className="size-3.5" /> : null}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <p className="text-[0.75rem] leading-relaxed text-ink-60">
              Anyone holding this link can write to your disk until it closes.
              Revoke it from the list when you have what you asked for.
            </p>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="quiet" onClick={reset}>
                Make another
              </Button>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${formId}-name`}>Name (optional)</Label>
              <Input
                id={`${formId}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Photos from the weekend"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={`${formId}-description`}>
                What to send (optional)
              </Label>
              <Input
                id={`${formId}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Shown to whoever opens the link"
              />
            </div>

            <ExpiryField legend="Closes" onChange={setExpiry} />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${formId}-files`}>Max files</Label>
                <Input
                  id={`${formId}-files`}
                  type="number"
                  min={1}
                  value={maxFiles}
                  onChange={(event) => setMaxFiles(event.target.value)}
                  placeholder="Unlimited"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`${formId}-size`}>Max size each (MB)</Label>
                <Input
                  id={`${formId}-size`}
                  type="number"
                  min={1}
                  value={maxUploadMb}
                  onChange={(event) => setMaxUploadMb(event.target.value)}
                  placeholder="Unlimited"
                />
              </div>
            </div>

            {/*
              Both fields left blank means an open-ended write channel into the
              operator's disk. That is allowed — principle 3 — but it should be
              a choice made in the open.
            */}
            {!maxFiles && !maxUploadMb && (
              <p className="border border-dotted border-ink-40 px-2.5 py-2 text-[0.75rem] leading-relaxed text-ink-60">
                <span className="text-ink-90">No ceiling on this one.</span>{" "}
                Anyone with the link can fill your disk until it closes.
              </p>
            )}

            <label className="flex items-center gap-2.5 text-[0.75rem] text-ink-60">
              <input
                type="checkbox"
                checked={requireUploader}
                onChange={(event) => setRequireUploader(event.target.checked)}
                className="size-3.5 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100"
              />
              Ask senders for a name
            </label>

            {error && (
              <p
                role="alert"
                className="bg-ink-100 px-2 py-1 text-[0.75rem] font-bold text-ground"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Creating…" : "Create link"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
