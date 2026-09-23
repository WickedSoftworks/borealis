"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { ExpiryField } from "@/components/expiry-field";
import type { FolderViewNode } from "@/components/folder-tree";
import {
  AllowListField,
  NotifyField,
  type ShareFormContext,
} from "@/components/share-fields";
import {
  type PickerFile,
  ShareItemPicker,
} from "@/components/share-item-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/world/dialog";
import { IconCheck } from "@/components/world/icons";
import { encodeKeyFragment } from "@/lib/crypto/fragment";
import { partitionByKey } from "@/lib/crypto/keyring";
import { formatBytes } from "@/lib/format";
import { capWarnings } from "@/lib/shares/edit";
import type { ExpiryInput } from "@/lib/shares/expiry";

type ShareDetail = {
  id: string;
  url: string;
  name: string | null;
  description: string | null;
  hasPassword: boolean;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  egressLimitBytes: number | null;
  egressUsedBytes: number;
  viewOnly: boolean;
  notifyOnDownload: boolean;
  notifyEmail: string | null;
  allowedIps: string | null;
  fileIds: string[];
  folderIds: string[];
};

type PasswordMode = "keep" | "set" | "remove";

const CHECKBOX =
  "size-3.5 shrink-0 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100";
const RADIO = `${CHECKBOX} rounded-full`;

const sameIds = (a: string[], b: Set<string>) =>
  a.length === b.size && a.every((id) => b.has(id));

/**
 * Edit a live link.
 *
 * The point of the product is that a leaked link is a bounded event, and until
 * now every one of those bounds was frozen at creation — getting a cap or an
 * expiry wrong meant revoking and re-sending, which is the situation the caps
 * exist to prevent.
 *
 * Three things this dialog has to say out loud rather than do quietly:
 * changing the password signs out everyone holding an unlock, a cap below
 * current usage closes the link on save, and adding an encrypted file breaks
 * every copy of the link already sent.
 */
export function EditShareDialog({
  shareId,
  children,
}: {
  shareId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const fieldId = useId();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<ShareDetail | null>(null);
  const [files, setFiles] = useState<PickerFile[]>([]);
  const [folders, setFolders] = useState<FolderViewNode[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expiry, setExpiry] = useState<ExpiryInput | null>(null);
  const [passwordMode, setPasswordMode] = useState<PasswordMode>("keep");
  const [password, setPassword] = useState("");
  const [maxDownloads, setMaxDownloads] = useState("");
  const [egressLimitMb, setEgressLimitMb] = useState("");
  const [viewOnly, setViewOnly] = useState(false);
  const [notifyOnDownload, setNotifyOnDownload] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [allowedIps, setAllowedIps] = useState("");
  const [context, setContext] = useState<ShareFormContext>({
    mailConfigured: false,
    addressesVisible: false,
  });
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(
    new Set(),
  );

  /** Set after a save that added encrypted files, so the sender can re-send. */
  const [updatedUrl, setUpdatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyNote, setKeyNote] = useState<string | null>(null);

  // Everything the dialog shows is fetched when it opens rather than threaded
  // through the share list, so the dashboard does not carry the description,
  // the notify fields, and every item id for links nobody edits.
  useEffect(() => {
    if (!open) return;

    let live = true;

    setLoading(true);
    setError(null);
    setUpdatedUrl(null);
    setKeyNote(null);
    setPassword("");
    setPasswordMode("keep");

    (async () => {
      const [shareRes, foldersRes, filesRes] = await Promise.all([
        fetch(`/api/shares/${shareId}`),
        fetch("/api/folders"),
        fetch("/api/list"),
      ]);

      if (!live) return;

      const shareBody = await shareRes.json().catch(() => null);

      if (!shareRes.ok || !shareBody?.share) {
        setLoading(false);
        setError(shareBody?.error ?? "Could not load this link.");
        return;
      }

      const share: ShareDetail = shareBody.share;
      const foldersBody = await foldersRes.json().catch(() => null);
      const filesBody = await filesRes.json().catch(() => null);

      if (!live) return;

      setDetail(share);
      setName(share.name ?? "");
      setDescription(share.description ?? "");
      setMaxDownloads(
        share.maxDownloads === null ? "" : String(share.maxDownloads),
      );
      setEgressLimitMb(
        share.egressLimitBytes === null
          ? ""
          : String(Math.round(share.egressLimitBytes / 1024 / 1024)),
      );
      setViewOnly(share.viewOnly);
      setNotifyOnDownload(share.notifyOnDownload);
      setNotifyEmail(share.notifyEmail ?? "");
      setAllowedIps(share.allowedIps ?? "");
      if (shareBody.context) setContext(shareBody.context);
      setSelectedFiles(new Set(share.fileIds));
      setSelectedFolders(new Set(share.folderIds));
      setFolders(foldersBody?.folders ?? []);
      setFiles(filesBody?.files ?? []);
      setLoading(false);
    })();

    return () => {
      live = false;
    };
  }, [open, shareId]);

  const toggle = (setter: typeof setSelectedFiles) => (id: string) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ExpiryField fires an effect on every change and documents that its handler
  // must be referentially stable.
  const onExpiryChange = useCallback((next: ExpiryInput | null) => {
    setExpiry(next);
  }, []);

  const nextMaxDownloads = maxDownloads ? Number(maxDownloads) : null;
  const nextEgressBytes = egressLimitMb
    ? Number(egressLimitMb) * 1024 * 1024
    : null;

  // The same rule the guard enforces, imported rather than restated.
  const warnings = detail
    ? capWarnings(
        {
          downloadCount: detail.downloadCount,
          egressUsedBytes: detail.egressUsedBytes,
        },
        { maxDownloads: nextMaxDownloads, egressLimitBytes: nextEgressBytes },
      )
    : [];

  const addedEncrypted = detail
    ? files.filter(
        (file) =>
          file.isEncrypted &&
          selectedFiles.has(file.id) &&
          !detail.fileIds.includes(file.id),
      )
    : [];

  const emptySelection = selectedFiles.size === 0 && selectedFolders.size === 0;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!detail) return;

    setPending(true);
    setError(null);

    // Only what actually changed is sent: an absent key means "leave it alone",
    // so an untouched field can never overwrite itself with a stale value.
    const body: Record<string, unknown> = {};

    if (name !== (detail.name ?? "")) body.name = name || null;
    if (description !== (detail.description ?? "")) {
      body.description = description || null;
    }
    if (expiry !== null) body.expiry = expiry;
    if (passwordMode === "set") body.password = password;
    if (passwordMode === "remove") body.password = null;
    if (nextMaxDownloads !== detail.maxDownloads) {
      body.maxDownloads = nextMaxDownloads;
    }
    if (nextEgressBytes !== detail.egressLimitBytes) {
      body.egressLimitBytes = nextEgressBytes;
    }
    if (viewOnly !== detail.viewOnly) body.viewOnly = viewOnly;
    if (notifyOnDownload !== detail.notifyOnDownload) {
      body.notifyOnDownload = notifyOnDownload;
    }
    if (notifyEmail !== (detail.notifyEmail ?? "")) {
      body.notifyEmail = notifyEmail || null;
    }
    if (allowedIps.trim() !== (detail.allowedIps ?? "")) {
      body.allowedIps = allowedIps.trim() || null;
    }
    if (!sameIds(detail.fileIds, selectedFiles)) {
      body.fileIds = [...selectedFiles];
    }
    if (!sameIds(detail.folderIds, selectedFolders)) {
      body.folderIds = [...selectedFolders];
    }

    if (Object.keys(body).length === 0) {
      setPending(false);
      setOpen(false);
      return;
    }

    const response = await fetch(`/api/shares/${shareId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await response.json().catch(() => null);

    setPending(false);

    if (!response.ok) {
      setError(result?.error ?? "Could not save those changes.");
      return;
    }

    router.refresh();

    // Adding an encrypted file leaves every link already sent without a key for
    // it, so the sender is handed a rebuilt one rather than left to guess.
    if (addedEncrypted.length > 0) {
      const encryptedInShare = files
        .filter((file) => file.isEncrypted && selectedFiles.has(file.id))
        .map((file) => file.id);

      const { known, missing } = partitionByKey(encryptedInShare);

      setUpdatedUrl(
        `${window.location.origin}${result.share.url}${encodeKeyFragment(known)}`,
      );
      setKeyNote(
        missing.length > 0
          ? `${missing.length} encrypted file${missing.length === 1 ? "" : "s"} in this link had no key in this browser. The recipient will not be able to open ${missing.length === 1 ? "it" : "them"}.`
          : null,
      );
      return;
    }

    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent
        title={updatedUrl ? "Link updated" : "Edit link"}
        description={
          updatedUrl
            ? "Send this link instead — the one you shared before has no key for the files you just added."
            : undefined
        }
      >
        {updatedUrl ? (
          <div className="flex flex-col gap-3">
            <Input readOnly value={updatedUrl} aria-label="Updated link" />

            {keyNote && (
              <output className="block text-[0.75rem] leading-relaxed text-ink-90">
                {keyNote}
              </output>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="quiet"
                onClick={async () => {
                  await navigator.clipboard.writeText(updatedUrl);
                  setCopied(true);
                }}
              >
                {copied ? (
                  <>
                    <IconCheck className="size-3" />
                    Copied
                  </>
                ) : (
                  "Copy link"
                )}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => setOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
        ) : loading ? (
          <p className="py-6 text-center text-[0.75rem] text-ink-60">
            Loading…
          </p>
        ) : !detail ? (
          <p
            role="alert"
            className="bg-ink-100 px-2 py-1 text-[0.75rem] font-bold text-ground"
          >
            {error ?? "Could not load this link."}
          </p>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-name`}>Name</Label>
              <Input
                id={`${fieldId}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-description`}>
                Description — shown to the recipient
              </Label>
              <Input
                id={`${fieldId}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Files and folders</Label>
              <ShareItemPicker
                files={files}
                folders={folders}
                selectedFiles={selectedFiles}
                selectedFolders={selectedFolders}
                onToggleFile={toggle(setSelectedFiles)}
                onToggleFolder={toggle(setSelectedFolders)}
              />
              <p className="text-[0.6875rem] text-ink-60">
                A shared folder is resolved every time the link is opened, so
                anything added to it later is carried too.
              </p>
            </div>

            <ExpiryField
              current={{ expiresAt: detail.expiresAt }}
              onChange={onExpiryChange}
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
                Password
              </legend>

              {(
                [
                  ["keep", detail.hasPassword ? "Keep current" : "No password"],
                  ["set", detail.hasPassword ? "Change it" : "Add one"],
                  ["remove", "Remove it"],
                ] as const
              ).map(([value, label]) =>
                value === "remove" && !detail.hasPassword ? null : (
                  <label
                    key={value}
                    className="flex items-center gap-2.5 text-[0.75rem] text-ink-60"
                  >
                    <input
                      type="radio"
                      name={`${fieldId}-password-mode`}
                      checked={passwordMode === value}
                      onChange={() => setPasswordMode(value)}
                      className={RADIO}
                    />
                    {label}
                  </label>
                ),
              )}

              {passwordMode === "set" && (
                <Input
                  type="password"
                  aria-label="New password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  maxLength={400}
                  required
                />
              )}

              {passwordMode !== "keep" && (
                <p
                  aria-live="polite"
                  className="border-t border-dotted border-ink-20 pt-2 text-[0.6875rem] text-ink-60"
                >
                  {passwordMode === "remove"
                    ? "Anyone with the link will be able to open it without a password."
                    : "Everyone who has already unlocked this link will be asked again."}
                </p>
              )}
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-downloads`}>
                  Max downloads — blank for no limit
                </Label>
                <Input
                  id={`${fieldId}-downloads`}
                  type="number"
                  min={1}
                  value={maxDownloads}
                  onChange={(event) => setMaxDownloads(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-egress`}>
                  Transfer cap in MB — blank for no limit
                </Label>
                <Input
                  id={`${fieldId}-egress`}
                  type="number"
                  min={1}
                  value={egressLimitMb}
                  onChange={(event) => setEgressLimitMb(event.target.value)}
                />
              </div>
            </div>

            <p className="text-[0.6875rem] text-ink-60">
              Used so far: {detail.downloadCount} download
              {detail.downloadCount === 1 ? "" : "s"},{" "}
              {formatBytes(detail.egressUsedBytes)} transferred.
            </p>

            <label className="flex items-center gap-2.5 text-[0.75rem] text-ink-60">
              <input
                type="checkbox"
                checked={viewOnly}
                onChange={(event) => setViewOnly(event.target.checked)}
                className={CHECKBOX}
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

            {(warnings.length > 0 || addedEncrypted.length > 0) && (
              <output
                aria-live="polite"
                className="block border border-dotted border-ink-40 p-2 text-[0.75rem] leading-relaxed text-ink-90"
              >
                {warnings.map((warning) =>
                  warning.cap === "downloads" ? (
                    <span key="downloads" className="block">
                      This link has already been downloaded {warning.used} time
                      {warning.used === 1 ? "" : "s"}. A cap of {warning.limit}{" "}
                      stops it working immediately.
                    </span>
                  ) : (
                    <span key="egress" className="block">
                      This link has already served {formatBytes(warning.used)}.
                      A cap of {formatBytes(warning.limit)} stops it working
                      immediately.
                    </span>
                  ),
                )}

                {addedEncrypted.length > 0 && (
                  <span className="block">
                    {addedEncrypted.length} encrypted file
                    {addedEncrypted.length === 1 ? "" : "s"} added. The key
                    travels in the link, so copies you have already sent cannot
                    open {addedEncrypted.length === 1 ? "it" : "them"} — you
                    will get a new link to send.
                  </span>
                )}
              </output>
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
                disabled={pending || emptySelection}
              >
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
