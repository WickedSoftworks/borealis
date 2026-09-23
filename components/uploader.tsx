"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
import {
  filesFromDrop,
  filesFromInput,
  type PickedFile,
} from "@/lib/dropped-files";
import { formatBytes } from "@/lib/format";
import {
  formatDuration,
  formatRate,
  remainingSeconds,
  type SpeedState,
  sampleSpeed,
  startSpeed,
  uploadErrorMessage,
} from "@/lib/transfer";
import { cn } from "@/lib/utils";

type Status =
  | "queued"
  | "preparing"
  | "encrypting"
  | "uploading"
  | "paused"
  | "done"
  | "error"
  | "cancelled";

type Transfer = {
  id: string;
  name: string;
  /** Where it is going, for display: "Photos / 2024". */
  destination: string | null;
  size: number;
  sent: number;
  status: Status;
  encrypted: boolean;
  resumed: boolean;
  speed: SpeedState;
  error?: string;
};

/** How many transfers run at once. The rest wait their turn. */
const CONCURRENCY = 3;

/**
 * Resumable upload field.
 *
 * Progress is drawn as glyph density rather than as a bar: the transfer fills
 * its own row with the dense end of the ramp as bytes land. Percentage, bytes,
 * speed, and time left ship alongside, so the texture is never the only
 * signal.
 *
 * Files go into the folder being viewed. A dropped or chosen FOLDER keeps its
 * shape — its subfolders are created, or reused if they already exist — and
 * files can also be pasted straight from the clipboard.
 *
 * Resuming is tus's whole point, so it is surfaced: a transfer can be paused
 * and continued, one interrupted by a closed tab picks up where it stopped
 * when the same file is chosen again, and at most three run at once so a
 * dropped folder of five hundred photos does not open five hundred sockets.
 */
export function Uploader({
  className,
  folderId = null,
  folderName = null,
}: {
  className?: string;
  /** Where new uploads land. Null is the top of the vault. */
  folderId?: string | null;
  folderName?: string | null;
}) {
  const router = useRouter();
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [dragging, setDragging] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Live handles, kept out of state: a tus Upload is mutable and not
  // something React should diff.
  const uploads = useRef(new Map<string, Upload>());
  const queue = useRef<Array<() => Promise<void>>>([]);
  const active = useRef(0);

  const update = useCallback((id: string, patch: Partial<Transfer>) => {
    setTransfers((current) =>
      current.map((transfer) =>
        transfer.id === id ? { ...transfer, ...patch } : transfer,
      ),
    );
  }, []);

  const pump = useCallback(() => {
    while (active.current < CONCURRENCY && queue.current.length > 0) {
      const next = queue.current.shift();
      if (!next) break;
      active.current++;
      void next().finally(() => {
        active.current--;
        pump();
      });
    }
  }, []);

  /**
   * One folder path to a folder id, created on demand and cached for the
   * batch, so a folder of a thousand files asks the server once per folder.
   */
  const ensureFolder = useCallback(
    async (segments: string[], cache: Map<string, Promise<string | null>>) => {
      if (segments.length === 0) return folderId;

      const key = segments.join("/");
      const cached = cache.get(key);
      if (cached) return cached;

      const pending = (async () => {
        const response = await fetch("/api/folders/ensure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId: folderId, path: segments }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(body?.error ?? "Could not create the folder.");
        return body.folderId as string;
      })();

      cache.set(key, pending);
      return pending;
    },
    [folderId],
  );

  const run = useCallback(
    (
      id: string,
      picked: PickedFile,
      encrypting: boolean,
      cache: Map<string, Promise<string | null>>,
    ) =>
      new Promise<void>((settle) => {
        void (async () => {
          const { file } = picked;

          let target: string | null;

          try {
            update(id, { status: "preparing" });
            target = await ensureFolder(picked.folders, cache);
          } catch (error) {
            update(id, {
              status: "error",
              error:
                error instanceof Error
                  ? error.message
                  : "Could not create the folder.",
            });
            settle();
            return;
          }

          // The key never leaves this function's scope except into the
          // browser's own keyring — it is not sent with the upload and never
          // could be.
          let body: Blob = file;
          let encodedKey: string | null = null;
          const metadata: Record<string, string> = {
            filename: file.name,
            filetype: file.type,
            ...(target ? { folderId: target } : {}),
          };

          if (encrypting) {
            try {
              update(id, { status: "encrypting", sent: 0 });
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
              settle();
              return;
            }
          }

          const upload = new Upload(body, {
            endpoint: "/api/upload",
            retryDelays: [0, 1000, 3000, 5000, 10000],
            metadata,
            // Ciphertext is different on every attempt — fresh key, fresh IVs
            // — so an encrypted upload can never resume across a reload.
            storeFingerprintForResuming: !encrypting,
            removeFingerprintOnSuccess: true,
            onProgress(sent, total) {
              setTransfers((current) =>
                current.map((transfer) =>
                  transfer.id === id
                    ? {
                        ...transfer,
                        sent,
                        size: total,
                        speed: sampleSpeed(transfer.speed, sent, Date.now()),
                      }
                    : transfer,
                ),
              );
            },
            onSuccess({ lastResponse }) {
              // The key is worthless without the id of the row it decrypts,
              // so it is only stored once the server has confirmed the file.
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
                  uploads.current.delete(id);
                  settle();
                  return;
                }
              }

              update(id, { status: "done", sent: body.size });
              uploads.current.delete(id);
              router.refresh();
              settle();
            },
            onError(error) {
              update(id, { status: "error", error: uploadErrorMessage(error) });
              uploads.current.delete(id);
              settle();
            },
          });

          uploads.current.set(id, upload);

          // A transfer cut off by a closed tab or a crash picks up where it
          // stopped when the same file is chosen again.
          const previous = encrypting ? [] : await upload.findPreviousUploads();
          const resumed = previous.length > 0;
          if (resumed) upload.resumeFromPreviousUpload(previous[0]);

          update(id, {
            status: "uploading",
            sent: 0,
            size: body.size,
            resumed,
            speed: startSpeed(Date.now()),
          });

          upload.start();
        })();
      }),
    [ensureFolder, router, update],
  );

  const start = useCallback(
    (picked: PickedFile[], encrypting: boolean) => {
      if (picked.length === 0) return;

      setNotice(null);
      const cache = new Map<string, Promise<string | null>>();

      const added: Transfer[] = picked.map(({ file, folders }) => ({
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        name: file.name,
        destination:
          [folderName, ...folders].filter(Boolean).join(" / ") || null,
        size: file.size,
        sent: 0,
        status: "queued",
        encrypted: encrypting,
        resumed: false,
        speed: startSpeed(Date.now()),
      }));

      setTransfers((current) => [...current, ...added]);

      added.forEach((transfer, index) => {
        queue.current.push(() =>
          run(transfer.id, picked[index], encrypting, cache),
        );
      });

      pump();
    },
    [folderName, pump, run],
  );

  // Paste to upload: a screenshot on the clipboard is one keystroke from the
  // vault. Ignored while typing in a field, so pasting a search term into the
  // search box does not upload it.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;

      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;

      event.preventDefault();

      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      start(
        files.map((file, index) => ({
          // Browsers name every pasted image "image.png"; give each a name
          // that will not collide with the last one.
          file:
            file.name === "image.png" || !file.name
              ? new File(
                  [file],
                  `pasted-${stamp}${index ? `-${index}` : ""}.${file.type.split("/")[1] ?? "bin"}`,
                  {
                    type: file.type,
                  },
                )
              : file,
          folders: [],
        })),
        encrypt,
      );
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [encrypt, start]);

  function pause(id: string) {
    const upload = uploads.current.get(id);
    if (!upload) return;
    void upload.abort(false);
    update(id, { status: "paused" });
  }

  function resume(id: string) {
    const upload = uploads.current.get(id);
    if (!upload) return;
    update(id, { status: "uploading", speed: startSpeed(Date.now()) });
    upload.start();
  }

  function cancel(id: string) {
    const upload = uploads.current.get(id);
    // `true` also asks the server to delete what it received so far.
    if (upload) void upload.abort(true);
    uploads.current.delete(id);
    update(id, { status: "cancelled" });
  }

  async function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    start(await filesFromDrop(event.dataTransfer), encrypt);
  }

  const finished = transfers.filter((t) =>
    ["done", "cancelled"].includes(t.status),
  ).length;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag target; the buttons inside are the keyboard path */}
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
          Drop files or folders here, or paste — transfers resume if the
          connection drops.
        </p>

        {folderName && (
          <p className="text-[0.6875rem] uppercase tracking-[0.16em] text-ink-60">
            Into {folderName}
          </p>
        )}

        <div className="flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={() => inputRef.current?.click()}
          >
            Choose files
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={() => folderInputRef.current?.click()}
          >
            Choose a folder
          </Button>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            start(filesFromInput(event.target.files), encrypt);
            event.target.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          // Non-standard but universal; React passes it through as-is.
          {...{ webkitdirectory: "", directory: "" }}
          onChange={(event) => {
            start(filesFromInput(event.target.files), encrypt);
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
              of the URL browsers never send. Encrypted uploads cannot resume
              after the page is closed.
            </>
          ) : (
            "Files are stored as-is. The server can read them, which is what makes previews, thumbnails, and content search possible."
          )}
        </p>
      </div>

      {notice && (
        <output className="block text-[0.75rem] text-ink-90">{notice}</output>
      )}

      {transfers.length > 0 && (
        <div className="flex flex-col gap-2">
          {finished > 0 && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setTransfers((current) =>
                    current.filter(
                      (t) => !["done", "cancelled"].includes(t.status),
                    ),
                  )
                }
              >
                Clear finished
              </Button>
            </div>
          )}

          <ul className="flex flex-col gap-2" aria-live="polite">
            {transfers.map((transfer) => (
              <TransferRow
                key={transfer.id}
                transfer={transfer}
                onPause={() => pause(transfer.id)}
                onResume={() => resume(transfer.id)}
                onCancel={() => cancel(transfer.id)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TransferRow({
  transfer,
  onPause,
  onResume,
  onCancel,
}: {
  transfer: Transfer;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const ratio = transfer.size > 0 ? transfer.sent / transfer.size : 0;
  const cells = 32;
  const filled = Math.round(ratio * cells);
  const eta = remainingSeconds(transfer.speed, transfer.sent, transfer.size);

  const state =
    transfer.status === "error"
      ? "failed"
      : transfer.status === "done"
        ? "complete"
        : transfer.status === "cancelled"
          ? "cancelled"
          : transfer.status === "queued"
            ? "waiting"
            : transfer.status === "paused"
              ? "paused"
              : `${Math.round(ratio * 100)}%`;

  const detail =
    transfer.status === "error"
      ? (transfer.error ?? "Upload failed. Choose the file again to retry.")
      : transfer.status === "encrypting"
        ? `Encrypting — ${formatBytes(transfer.sent)} of ${formatBytes(transfer.size)}`
        : transfer.status === "queued"
          ? `Waiting — ${formatBytes(transfer.size)}`
          : transfer.status === "preparing"
            ? "Preparing…"
            : transfer.status === "cancelled"
              ? "Cancelled; nothing was kept."
              : [
                  `${formatBytes(transfer.sent)} of ${formatBytes(transfer.size)}`,
                  transfer.status === "uploading" &&
                    transfer.speed.rate !== null &&
                    formatRate(transfer.speed.rate),
                  transfer.status === "uploading" &&
                    eta !== null &&
                    `${formatDuration(eta)} left`,
                  transfer.resumed && "resumed",
                ]
                  .filter(Boolean)
                  .join(" · ");

  const live = ["uploading", "paused"].includes(transfer.status);

  return (
    <li className="border border-dotted border-ink-20 px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[0.8125rem] text-ink-80">
          {transfer.name}
          {transfer.destination && (
            <span className="text-ink-60"> → {transfer.destination}</span>
          )}
        </span>
        <span className="flex shrink-0 items-baseline gap-2 text-[0.6875rem] tabular-nums text-ink-60">
          {transfer.encrypted && (
            <span className="uppercase tracking-[0.16em]">encrypted</span>
          )}
          {state}
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

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.6875rem] leading-relaxed text-ink-60">{detail}</p>

        {live && (
          <span className="flex gap-1">
            {transfer.status === "paused" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onResume}
              >
                Resume
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" onClick={onPause}>
                Pause
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}
