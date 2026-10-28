"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ShareComposer } from "@/components/share-composer";
import type { ShareFormContext } from "@/components/share-fields";
import { Button } from "@/components/ui/button";
import { type UploadedFile, Uploader } from "@/components/uploader";
import { IconCheck, IconClose } from "@/components/world/icons";
import { formatBytes } from "@/lib/format";

/**
 * Upload and link in one place. Each file the server confirms joins the link
 * being composed; the link can be made once nothing is still uploading, so a
 * recipient never opens a link to a file that is not there yet.
 */
export function SendComposer({ context }: { context: ShareFormContext }) {
  // Bumped by "Make another" to start over with nothing uploaded.
  const [round, setRound] = useState(0);

  return (
    <SendRound
      key={round}
      context={context}
      onAgain={() => setRound((current) => current + 1)}
    />
  );
}

function SendRound({
  context,
  onAgain,
}: {
  context: ShareFormContext;
  onAgain: () => void;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(0);
  const [created, setCreated] = useState(false);

  const onUploaded = useCallback((file: UploadedFile) => {
    setFiles((current) => [...current, file]);
  }, []);

  const total = files.reduce((sum, file) => sum + file.size, 0);

  const blocked =
    busy > 0
      ? `Waiting for ${busy} upload${busy === 1 ? "" : "s"} to finish.`
      : files.length === 0
        ? "Add files above to make a link."
        : null;

  return (
    <div className="flex flex-col gap-6">
      {!created && (
        <section className="rise" style={{ "--i": 1 } as React.CSSProperties}>
          <Uploader onUploaded={onUploaded} onBusyChange={setBusy} />
        </section>
      )}

      <section
        className="rise rounded-2xl border border-line bg-paper p-4 sm:p-6"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        <ShareComposer
          fileIds={files.map((file) => file.fileId)}
          encryptedFileIds={files
            .filter((file) => file.encrypted)
            .map((file) => file.fileId)}
          context={context}
          blocked={blocked}
          heading
          onCreated={() => setCreated(true)}
          onAgain={onAgain}
          onDone={() => router.push("/dashboard")}
          files={
            <section className="flex flex-col gap-2.5">
              <h2 className="label-caps">
                {files.length === 0
                  ? "In this link"
                  : `${files.length} file${files.length === 1 ? "" : "s"} · ${formatBytes(total)}`}
              </h2>

              {files.length === 0 ? (
                <p className="text-[13px] leading-relaxed text-fg-subtle">
                  Files appear here as each one finishes uploading.
                </p>
              ) : (
                <ul className="flex flex-col border-b border-line">
                  {files.map((file) => (
                    <li
                      key={file.fileId}
                      className="flex items-center gap-2 border-t border-line py-2"
                    >
                      <IconCheck className="size-3.5 shrink-0 text-accent" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-fg">
                          {file.name}
                        </span>
                        <span className="data text-fg-subtle">
                          {formatBytes(file.size)}
                          {file.encrypted && (
                            <span className="text-e2e"> · encrypted</span>
                          )}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Leave ${file.name} out of this link`}
                        onClick={() =>
                          setFiles((current) =>
                            current.filter(
                              (other) => other.fileId !== file.fileId,
                            ),
                          )
                        }
                      >
                        <IconClose className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-[13px] leading-relaxed text-fg-subtle">
                Uploads also stay in Files, so you can share them again.
              </p>
            </section>
          }
        />
      </section>
    </div>
  );
}
