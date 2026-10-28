"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSlab, Notice } from "@/components/world/notice";
import { exportKeys, importKeys, keyCount } from "@/lib/crypto/keyring";
import { saveBlob } from "@/lib/crypto/save";

/**
 * The keys to this account's encrypted files, as held by this browser.
 *
 * They exist nowhere else — the server never has them — so clearing site
 * data, a new laptop, or a different browser used to mean those files were
 * gone for good. A backup file is the way out, and importing it the way back
 * in. It is the keys in the clear, which the panel says before offering it.
 */
export function KeyBackup() {
  const inputId = useId();
  // Read after mount: the keyring lives in this browser, not on the server
  // that rendered the page.
  const [count, setCount] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCount(keyCount());
  }, []);

  function download() {
    const stamp = new Date().toISOString().slice(0, 10);

    saveBlob(
      new Blob([exportKeys()], { type: "application/json" }),
      `borealis-keys-${stamp}.json`,
    );
    setError(null);
    setNote(
      "Saved. Keep it somewhere you would keep a password — anyone with this file and the stored bytes can read those files.",
    );
  }

  async function restore(file: File | undefined) {
    if (!file) return;

    const imported = importKeys(await file.text());

    if (imported === null) {
      setNote(null);
      setError(
        "That is not a Borealis key backup, or this browser would not store it.",
      );
      return;
    }

    setError(null);
    setNote(
      `${imported} key${imported === 1 ? "" : "s"} available in this browser.`,
    );
    setCount(keyCount());
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-fg">
        {count === null
          ? "Counting the keys in this browser…"
          : `This browser holds ${count} key${count === 1 ? "" : "s"} for files encrypted before upload.`}{" "}
        They are the only copies: clear this browser&apos;s site data, or move
        to another one, and those files cannot be opened without a backup.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!count}
          onClick={download}
        >
          Download key backup
        </Button>

        <Button asChild variant="quiet" size="sm">
          <label htmlFor={inputId}>Import a backup</label>
        </Button>
        <input
          id={inputId}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            void restore(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      <Notice>{note}</Notice>
      <ErrorSlab>{error}</ErrorSlab>
    </div>
  );
}
