"use client";

import { useRef, useState } from "react";
import { Upload } from "tus-js-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconCheck, IconUpload } from "@/components/world/icons";
import { ProgressBar } from "@/components/world/meter";
import { formatBytes } from "@/lib/format";
import { uploadErrorMessage } from "@/lib/transfer";
import { cn } from "@/lib/utils";

type Transfer = {
  id: string;
  name: string;
  size: number;
  sent: number;
  status: "uploading" | "done" | "error";
  error?: string;
};

export function ReverseUploader({
  token,
  requireUploader,
  maxBytes,
}: {
  token: string;
  requireUploader: boolean;
  maxBytes: number | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploader, setUploader] = useState("");
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(id: string, patch: Partial<Transfer>) {
    setTransfers((current) =>
      current.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }

  function start(files: File[]) {
    if (requireUploader && !uploader.trim()) {
      setError("Please say who these are from first.");
      return;
    }

    setError(null);

    for (const file of files) {
      if (maxBytes !== null && file.size > maxBytes) {
        setError(
          `${file.name} is ${formatBytes(file.size)} — this link accepts at most ${formatBytes(maxBytes)}.`,
        );
        continue;
      }

      const id = `${file.name}-${crypto.randomUUID()}`;

      const upload = new Upload(file, {
        endpoint: "/api/reverse-upload",
        retryDelays: [0, 1000, 3000, 5000, 10000],
        // Nothing here resumes across page loads, so there is no reason to
        // leave each upload's URL behind in this browser's storage.
        storeFingerprintForResuming: false,
        metadata: {
          token,
          filename: file.name,
          filetype: file.type,
          uploader: uploader.trim(),
        },
        onProgress(sent, total) {
          update(id, { sent, size: total });
        },
        onSuccess() {
          update(id, { status: "done", sent: file.size });
        },
        onError(err) {
          update(id, { status: "error", error: uploadErrorMessage(err) });
        },
      });

      setTransfers((current) => [
        ...current,
        { id, name: file.name, size: file.size, sent: 0, status: "uploading" },
      ]);

      upload.start();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {requireUploader && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="uploader">Who are these from?</Label>
          <Input
            id="uploader"
            value={uploader}
            onChange={(event) => setUploader(event.target.value)}
            placeholder="Your name"
            maxLength={100}
            required
          />
        </div>
      )}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag target; the button inside is the keyboard path */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          start(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-10 text-center transition-colors",
          dragging
            ? "border-accent bg-accent-soft"
            : "border-line-strong bg-paper",
        )}
      >
        <span
          aria-hidden="true"
          className="grid size-11 place-items-center rounded-full bg-accent-soft text-accent"
        >
          <IconUpload className="size-5" />
        </span>

        <p className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-fg">
            Drop files here, or choose them
          </span>
          <span className="text-[13px] text-fg-subtle">
            Transfers resume if your connection drops.
          </span>
        </p>

        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </Button>

        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => {
            start(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-fg"
        >
          {error}
        </p>
      )}

      {transfers.length > 0 && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {transfers.map((transfer) => {
            const ratio = transfer.size > 0 ? transfer.sent / transfer.size : 0;

            return (
              <li
                key={transfer.id}
                className="rounded-lg border border-line bg-paper px-3 py-2.5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium text-fg">
                    {transfer.name}
                  </span>
                  <span className="data shrink-0 text-fg-subtle">
                    {transfer.status === "error" ? (
                      "failed"
                    ) : transfer.status === "done" ? (
                      <>
                        <IconCheck className="mr-1 inline size-3 align-[-2px]" />
                        sent
                      </>
                    ) : (
                      `${Math.round(ratio * 100)}%`
                    )}
                  </span>
                </div>

                <ProgressBar
                  ratio={ratio}
                  tone={transfer.status === "error" ? "danger" : "normal"}
                  className="mt-2"
                />

                {transfer.status === "error" && (
                  <p className="mt-1 text-[13px] text-fg-subtle">
                    {transfer.error ?? "Upload failed."}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
