"use client";

import { useRouter } from "next/navigation";
import { useCallback, useId, useRef, useState } from "react";
import { Upload } from "tus-js-client";
import { Button } from "@/components/ui/button";
import { IconUpload } from "@/components/world/icons";
import { RAMP } from "@/components/world/ramp";
import {
  CHUNK_SIZE,
  type EncryptionMeta,
  encryptFile,
  generateKey,
} from "@/lib/crypto/e2e";
import { rememberKey } from "@/lib/crypto/keyring";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

type Transfer = {
  id: string;
  name: string;
  size: number;
  sent: number;
  status: "encrypting" | "uploading" | "done" | "error" | "paused";
  encrypted: boolean;
  error?: string;
  upload?: Upload;
};

/**
 * Resumable upload field.
 *
 * Progress is drawn as glyph density rather than as a bar: the transfer fills
 * its own row with the dense end of the ramp as bytes land. Percentage and byte
 * counts ship alongside, so the texture is never the only signal.
 */
export function Uploader({ className }: { className?: string }) {
  const router = useRouter();
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [dragging, setDragging] = useState(false);
  const [encrypt, setEncrypt] = useState(false);

  const update = useCallback((id: string, patch: Partial<Transfer>) => {
    setTransfers((current) =>
      current.map((transfer) =>
        transfer.id === id ? { ...transfer, ...patch } : transfer,
      ),
    );
  }, []);

  const start = useCallback(
    async (files: File[], encrypting: boolean) => {
      for (const file of files) {
        const id = `${file.name}-${file.size}-${crypto.randomUUID()}`;

        setTransfers((current) => [
          ...current,
          {
            id,
            name: file.name,
            size: file.size,
            sent: 0,
            status: encrypting ? "encrypting" : "uploading",
            encrypted: encrypting,
          },
        ]);

        // The key never leaves this function's scope except into the browser's
        // own keyring — it is not sent with the upload and never could be.
        let body: Blob = file;
        let encodedKey: string | null = null;
        const metadata: Record<string, string> = {
          filename: file.name,
          filetype: file.type,
        };

        if (encrypting) {
          try {
            const { key, encoded } = await generateKey();
            encodedKey = encoded;

            body = await encryptFile(file, key, (done, total) => {
              update(id, { sent: done, size: total });
            });

            const meta: EncryptionMeta = {
              algorithm: "AES-GCM",
              mode: "fragment",
              chunkSize: CHUNK_SIZE,
            };

            metadata.encrypted = "true";
            metadata.encryptionMeta = JSON.stringify(meta);
          } catch (error) {
            update(id, {
              status: "error",
              error:
                error instanceof Error
                  ? `Encryption failed: ${error.message}`
                  : "Encryption failed; nothing was uploaded.",
            });
            continue;
          }
        }

        const upload = new Upload(body, {
          endpoint: "/api/upload",
          retryDelays: [0, 1000, 3000, 5000, 10000],
          metadata,
          onProgress(sent, total) {
            update(id, { sent, size: total });
          },
          onSuccess({ lastResponse }) {
            // The key is worthless without the id of the row it decrypts, so
            // it is only stored once the server has confirmed the file exists.
            const fileId = lastResponse.getHeader("X-File-Id");

            if (encodedKey) {
              if (fileId) {
                rememberKey(fileId, encodedKey);
              } else {
                update(id, {
                  status: "error",
                  error:
                    "Uploaded, but the server did not return a file id, so the key could not be kept. This file cannot be decrypted — delete it and try again.",
                });
                return;
              }
            }

            update(id, { status: "done", sent: body.size });
            router.refresh();
          },
          onError(error) {
            update(id, { status: "error", error: error.message });
          },
        });

        update(id, { status: "uploading", sent: 0, size: body.size, upload });
        upload.start();
      }
    },
    [router, update],
  );

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    void start(Array.from(event.dataTransfer.files), encrypt);
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag target; the button inside is the keyboard path */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "material-grid flex flex-col items-center justify-center gap-3 border border-dotted px-4 py-10 text-center transition-colors",
          dragging ? "border-ink-100 bg-ink-00/60" : "border-ink-20",
        )}
      >
        <IconUpload className="size-6 text-ink-60" />

        <p className="text-[0.8125rem] text-ink-60">
          Drop files here — transfers resume if the connection drops.
        </p>

        <Button
          type="button"
          variant="primary"
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
            void start(Array.from(event.target.files ?? []), encrypt);
            event.target.value = "";
          }}
        />
      </div>

      {/*
        Stated exactly, because principle 4 forbids implying more than is true:
        the bytes are unreadable to the server, the name and size are not, and
        the key has exactly one copy.
      */}
      <div className="border border-dotted border-ink-20 px-3 py-2.5">
        <label
          htmlFor={`${fieldId}-encrypt`}
          className="flex items-center gap-2.5 text-[0.75rem] text-ink-80"
        >
          <input
            id={`${fieldId}-encrypt`}
            type="checkbox"
            checked={encrypt}
            onChange={(event) => setEncrypt(event.target.checked)}
            className="size-3.5 shrink-0 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100"
          />
          Encrypt in this browser
        </label>

        <p className="mt-1.5 pl-6 text-[0.6875rem] leading-relaxed text-ink-60">
          {encrypt ? (
            <>
              <span className="text-ink-90">
                The server stores bytes it cannot read.
              </span>{" "}
              Its filename and size stay visible, and the key is kept only in
              this browser — clear its site data and the file is gone for good,
              including for you. Links you make will carry the key in the part
              of the URL browsers never send.
            </>
          ) : (
            "Files are stored as-is. The server can read them, which is what makes previews and content search possible."
          )}
        </p>
      </div>

      {transfers.length > 0 && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {transfers.map((transfer) => {
            const ratio = transfer.size > 0 ? transfer.sent / transfer.size : 0;
            const cells = 32;
            const filled = Math.round(ratio * cells);

            return (
              <li
                key={transfer.id}
                className="border border-dotted border-ink-20 px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[0.8125rem] text-ink-80">
                    {transfer.name}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2 text-[0.6875rem] tabular-nums text-ink-60">
                    {transfer.encrypted && (
                      <span className="uppercase tracking-[0.16em]">
                        encrypted
                      </span>
                    )}
                    {transfer.status === "error"
                      ? "failed"
                      : transfer.status === "done"
                        ? "complete"
                        : `${Math.round(ratio * 100)}%`}
                  </span>
                </div>

                <div
                  aria-hidden="true"
                  className="mt-1 overflow-hidden font-mono text-[0.75rem] leading-none tracking-[0.1em] text-ink-80"
                >
                  {Array.from({ length: cells }, (_, index) =>
                    index < filled ? RAMP[RAMP.length - 1] : RAMP[0],
                  ).join("")}
                </div>

                <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-60">
                  {transfer.status === "error"
                    ? (transfer.error ??
                      "Upload failed. Choose the file again to retry.")
                    : transfer.status === "encrypting"
                      ? `Encrypting — ${formatBytes(transfer.sent)} of ${formatBytes(transfer.size)}`
                      : `${formatBytes(transfer.sent)} of ${formatBytes(transfer.size)}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
