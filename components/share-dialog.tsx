"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { ExpiryField } from "@/components/expiry-field";
import {
  AllowListField,
  NotifyField,
  type ShareFormContext,
} from "@/components/share-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/world/dialog";
import { IconCheck, IconShare } from "@/components/world/icons";
import { QrCode } from "@/components/world/qr";
import { encodeKeyFragment } from "@/lib/crypto/fragment";
import { partitionByKey } from "@/lib/crypto/keyring";
import type { ExpiryInput } from "@/lib/shares/expiry";

/**
 * Share composer.
 *
 * The expiry control is the centre of this dialog because it is the decision
 * that bounds everything else. It lives in its own component so that every
 * link-making surface offers exactly the same choices.
 */
export function ShareDialog({
  fileIds,
  folderIds = [],
  encryptedFileIds = [],
  disabled,
  context,
  children,
}: {
  fileIds: string[];
  /**
   * Folders to share whole. These resolve LIVE — a file added to one of them
   * later is part of the link from that moment, and cannot carry a key in the
   * fragment below, so the recipient page marks it as added later.
   */
  folderIds?: string[];
  /** Which of `fileIds` are client-side encrypted, so the link needs keys. */
  encryptedFileIds?: string[];
  disabled?: boolean;
  /** Whether mail leaves the box and addresses can be seen; see share-fields. */
  context: ShareFormContext;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const formId = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [notifyOnDownload, setNotifyOnDownload] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [allowedIps, setAllowedIps] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [expiry, setExpiry] = useState<ExpiryInput | null>({
    mode: "preset",
    preset: "1w",
  });
  const [password, setPassword] = useState("");
  const [maxDownloads, setMaxDownloads] = useState("");
  const [egressLimitMb, setEgressLimitMb] = useState("");
  const [viewOnly, setViewOnly] = useState(false);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * Which encrypted files this browser holds keys for. Read after mount rather
   * than during render: localStorage does not exist on the server, and a
   * key-dependent first paint would not match what the server sent.
   */
  const [keys, setKeys] = useState<{
    known: Array<{ fileId: string; key: string }>;
    missing: string[];
  }>({ known: [], missing: [] });

  // Joined so the effect depends on the contents, not on the array identity
  // the parent rebuilds every render.
  const encryptedIdList = encryptedFileIds.join(",");

  useEffect(() => {
    setKeys(partitionByKey(encryptedIdList ? encryptedIdList.split(",") : []));
  }, [encryptedIdList]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const response = await fetch("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileIds,
        folderIds,
        name: name || undefined,
        description: description.trim() || undefined,
        password: password || undefined,
        // Never null here: "Keep current" only exists when editing.
        expiry: expiry ?? undefined,
        maxDownloads: maxDownloads ? Number(maxDownloads) : null,
        egressLimitBytes: egressLimitMb
          ? Number(egressLimitMb) * 1024 * 1024
          : null,
        viewOnly,
        notifyOnDownload,
        notifyEmail:
          notifyOnDownload && notifyEmail.trim() ? notifyEmail.trim() : null,
        allowedIps: allowedIps.trim() || null,
      }),
    });

    setPending(false);
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setError(body?.error ?? "Could not create the share.");
      return;
    }

    // The keys ride in the fragment, which is why they are appended here and
    // never sent in the request that created the share.
    setCreatedUrl(
      `${window.location.origin}${body.url}${encodeKeyFragment(keys.known)}`,
    );
    router.refresh();
  }

  function reset() {
    setCreatedUrl(null);
    setCopied(false);
    setShowQr(false);
    setName("");
    setDescription("");
    setNotifyOnDownload(false);
    setNotifyEmail("");
    setAllowedIps("");
    setPassword("");
    setMaxDownloads("");
    setEgressLimitMb("");
    setViewOnly(false);
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
        {children ?? (
          <Button variant="primary" disabled={disabled}>
            <IconShare className="size-3.5" />
            Share
          </Button>
        )}
      </DialogTrigger>

      <DialogContent
        title={createdUrl ? "Link ready" : "New share"}
        description={
          createdUrl
            ? undefined
            : `${describeSelection(fileIds.length, folderIds.length)} — anyone with the link and its conditions can fetch ${fileIds.length + folderIds.length === 1 ? "it" : "them"}.`
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

            {/*
              Links get sent to phones. A code on this screen saves typing a
              22-character token into one. Offered, not shown by default, so
              the link itself stays the first thing on the screen.
            */}
            {showQr ? (
              <div className="flex flex-col items-center gap-2">
                <QrCode
                  value={createdUrl}
                  label="QR code for this link"
                  className="size-48 border border-ink-40"
                />
                <p className="text-[0.6875rem] text-ink-60">
                  Anyone who scans this has the link — show it only to the
                  person it is for.
                </p>
              </div>
            ) : (
              <Button
                type="button"
                variant="quiet"
                size="sm"
                className="self-start"
                onClick={() => setShowQr(true)}
              >
                Show QR code
              </Button>
            )}

            <p className="text-[0.75rem] leading-relaxed text-ink-60">
              {password
                ? "The password is not in this link. Send it separately."
                : "Anyone with this link can fetch the files until it expires."}
            </p>

            {keys.known.length > 0 && (
              <p className="border border-dotted border-ink-40 px-2.5 py-2 text-[0.75rem] leading-relaxed text-ink-60">
                <span className="text-ink-90">
                  Send this link whole — the decryption key is the part after
                  the #.
                </span>{" "}
                The server never receives that part, so a truncated copy is
                useless and no one here can complete it for you.
              </p>
            )}

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
                placeholder="Mixdowns for review"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={`${formId}-description`}>
                Message for the recipient (optional)
              </Label>
              <Input
                id={`${formId}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                placeholder="Shown at the top of the page they open"
              />
            </div>

            <ExpiryField onChange={setExpiry} />

            <div className="flex flex-col gap-2">
              <Label htmlFor={`${formId}-password`}>Password (optional)</Label>
              <Input
                id={`${formId}-password`}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="Sent separately from the link"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${formId}-downloads`}>Max downloads</Label>
                <Input
                  id={`${formId}-downloads`}
                  type="number"
                  min={1}
                  value={maxDownloads}
                  onChange={(event) => setMaxDownloads(event.target.value)}
                  placeholder="Unlimited"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`${formId}-egress`}>Transfer cap (MB)</Label>
                <Input
                  id={`${formId}-egress`}
                  type="number"
                  min={1}
                  value={egressLimitMb}
                  onChange={(event) => setEgressLimitMb(event.target.value)}
                  placeholder="Unlimited"
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-[0.75rem] text-ink-60">
              <input
                type="checkbox"
                checked={viewOnly}
                onChange={(event) => setViewOnly(event.target.checked)}
                className="size-3.5 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100"
              />
              Preview only — recipients cannot download
            </label>

            <NotifyField
              enabled={notifyOnDownload}
              email={notifyEmail}
              onEnabledChange={setNotifyOnDownload}
              onEmailChange={setNotifyEmail}
              mailConfigured={context.mailConfigured}
            />

            <AllowListField
              value={allowedIps}
              onChange={setAllowedIps}
              addressesVisible={context.addressesVisible}
            />

            {/*
              A share of a file this browser cannot decrypt would produce a
              link that silently fails for the recipient. Say so before it is
              made, not after.
            */}
            {keys.missing.length > 0 && (
              <p className="border border-dotted border-ink-40 px-2.5 py-2 text-[0.75rem] leading-relaxed text-ink-60">
                <span className="text-ink-90">
                  {keys.missing.length} encrypted{" "}
                  {keys.missing.length === 1 ? "file was" : "files were"}{" "}
                  uploaded from another browser.
                </span>{" "}
                Their keys are not here, so this link cannot carry them and the
                recipient will get bytes they cannot read. Make the link from
                the browser that uploaded them, or leave them out.
              </p>
            )}

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

function describeSelection(files: number, folders: number): string {
  const parts = [
    files > 0 && `${files} file${files === 1 ? "" : "s"}`,
    folders > 0 && `${folders} folder${folders === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return parts.join(" and ") || "Nothing selected";
}
