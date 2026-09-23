"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconDownload } from "@/components/world/icons";
import { StateTag } from "@/components/world/panel";
import { decodeKeyFragment } from "@/lib/crypto/fragment";
import { downloadEncrypted } from "@/lib/crypto/save";

/**
 * The recipient's half of a zero-knowledge share.
 *
 * The key is read from the URL fragment, which never reached the server, and
 * the file is decrypted here in the page. The server's role ends at handing
 * over ciphertext it cannot read.
 */
export function EncryptedDownload({
  token,
  fileId,
  filename,
  mimeType,
}: {
  token: string;
  fileId: string;
  filename: string;
  mimeType: string;
}) {
  const [key, setKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The fragment is only readable after hydration — it is not part of what the
  // server rendered, because the server never receives it.
  useEffect(() => {
    setKey(decodeKeyFragment(window.location.hash)[fileId] ?? null);
    setReady(true);
  }, [fileId]);

  async function run() {
    if (!key) return;

    setBusy(true);
    setError(null);

    try {
      await downloadEncrypted(
        `/api/s/${token}/download/${fileId}`,
        key,
        filename,
        mimeType,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The file could not be opened.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (ready && !key) {
    return <StateTag tone="alarm">Key missing</StateTag>;
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={!ready || busy}
        onClick={run}
      >
        <IconDownload className="size-3.5" />
        {busy ? "Opening…" : "Get"}
      </Button>

      {(busy || error) && (
        <output className="block max-w-56 text-right text-[0.625rem] leading-relaxed text-ink-60">
          {busy ? "Decrypting here in your browser…" : error}
        </output>
      )}
    </span>
  );
}
