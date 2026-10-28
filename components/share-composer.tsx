"use client";

import {
  ChevronRight,
  Copy,
  KeyRound,
  LockKeyhole,
  Minus,
  Plus,
  QrCode as QrIcon,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
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
import { Switch } from "@/components/ui/switch";
import { IconCheck } from "@/components/world/icons";
import { QrCode } from "@/components/world/qr";
import { encodeKeyFragment } from "@/lib/crypto/fragment";
import { partitionByKey } from "@/lib/crypto/keyring";
import {
  COMPOSER_PRESETS,
  type ComposerPreset,
  describeItems,
  describeLink,
  generatePassword,
  matchPreset,
} from "@/lib/shares/composer";
import {
  type ExpiryInput,
  type ExpiryPresetId,
  resolveExpiry,
} from "@/lib/shares/expiry";
import { cn } from "@/lib/utils";

const DEFAULT_PRESET = COMPOSER_PRESETS[1];
const GB = 1024 * 1024 * 1024;

const BOX =
  "flex flex-col gap-3 rounded-xl border border-line bg-ground p-3.5 sm:p-4";

/** "Tue, Nov 3, 5:50 PM" — short enough for a sentence. */
function shortDate(date: Date) {
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function positiveInt(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function positiveNumber(value: string): number | null {
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The share composer: what a link carries, the rules that bound it, and a
 * sentence saying what those rules add up to, before the link exists.
 *
 * Presets set the rules in one move for the common cases; every rule stays
 * editable, and editing one moves the choice to Custom. The sentence on the
 * right is the check: an owner reads what they are about to hand out, in
 * words, rather than reconstructing it from six controls.
 *
 * Used inside the share dialog and on the Send files page, which supplies
 * its own file list and holds creation back while uploads are running.
 */
export function ShareComposer({
  fileIds,
  folderIds = [],
  encryptedFileIds = [],
  context,
  files,
  blocked = null,
  heading = false,
  onCancel,
  onCreated,
  onAgain,
  onDone,
}: {
  fileIds: string[];
  /**
   * Folders to share whole. These resolve LIVE — a file added to one of them
   * later is part of the link from that moment, and cannot carry a key in the
   * fragment, so the recipient page marks it as added later.
   */
  folderIds?: string[];
  /** Which of `fileIds` are client-side encrypted, so the link needs keys. */
  encryptedFileIds?: string[];
  /** Whether mail leaves the box and addresses can be seen; see share-fields. */
  context: ShareFormContext;
  /** The top of the side column. Defaults to a line naming the selection. */
  files?: React.ReactNode;
  /** Why the link cannot be made yet, if it cannot. */
  blocked?: string | null;
  /** Whether the result names itself; a dialog already has a title. */
  heading?: boolean;
  onCancel?: () => void;
  onCreated?: () => void;
  onAgain: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const formId = useId();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // The expiry field keeps its own state. A preset sets it by remounting it
  // with a new default, the way an input's defaultValue is reset.
  const [expiry, setExpiry] = useState<ExpiryInput | null>({
    mode: "preset",
    preset: DEFAULT_PRESET.rules.expiry as ExpiryPresetId,
  });
  const [expiryDefault, setExpiryDefault] = useState(
    DEFAULT_PRESET.rules.expiry as ExpiryPresetId,
  );
  const [expiryRound, setExpiryRound] = useState(0);

  const [passwordOn, setPasswordOn] = useState(DEFAULT_PRESET.rules.password);
  const [password, setPassword] = useState("");
  const [maxDownloads, setMaxDownloads] = useState(
    String(DEFAULT_PRESET.rules.maxDownloads ?? ""),
  );
  const [capGb, setCapGb] = useState(String(DEFAULT_PRESET.rules.capGb ?? ""));

  const [moreOpen, setMoreOpen] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [notifyOnDownload, setNotifyOnDownload] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [allowedIps, setAllowedIps] = useState("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    url: string;
    password: string | null;
    summary: string;
  } | null>(null);
  const [copied, setCopied] = useState<"link" | "password" | null>(null);
  const [showQr, setShowQr] = useState(false);

  // Dates depend on this browser's clock and zone, so they are written only
  // after mount; the Send page renders on the server first.
  const [mounted, setMounted] = useState(false);

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

  // A preset that asks for a password starts with a generated one. Made after
  // mount: random on the server would never match random in the browser.
  useEffect(() => {
    setMounted(true);
    setPassword((current) => current || generatePassword());
  }, []);

  const downloads = positiveInt(maxDownloads);
  const cap = positiveNumber(capGb);
  const preset = matchPreset({
    expiry: expiry?.mode === "preset" ? expiry.preset : "other",
    password: passwordOn,
    maxDownloads: downloads,
    capGb: cap,
  });

  const ends = (() => {
    if (!expiry || !mounted) return "…";
    try {
      const date = resolveExpiry(expiry);
      return date === null ? null : shortDate(date);
    } catch {
      return "the date you pick";
    }
  })();

  const summary = describeLink({
    files: fileIds.length,
    folders: folderIds.length,
    password: passwordOn,
    viewOnly,
    maxDownloads: downloads,
    capGb: cap,
    ends,
    encrypted: encryptedFileIds.length,
  });

  function applyPreset(next: ComposerPreset) {
    setExpiryDefault(next.rules.expiry as ExpiryPresetId);
    setExpiryRound((round) => round + 1);
    setPasswordOn(next.rules.password);
    if (next.rules.password && !password) setPassword(generatePassword());
    setMaxDownloads(String(next.rules.maxDownloads ?? ""));
    setCapGb(String(next.rules.capGb ?? ""));
  }

  function stepDownloads(by: 1 | -1) {
    const next = (downloads ?? 0) + by;
    setMaxDownloads(next > 0 ? String(next) : "");
  }

  async function copy(text: string, what: "link" | "password") {
    await navigator.clipboard.writeText(text);
    setCopied(what);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (passwordOn && !password.trim()) {
      setError("Type a password, or turn the password off.");
      return;
    }

    if (maxDownloads.trim() && downloads === null) {
      setError("The download limit has to be a whole number above zero.");
      return;
    }

    if (capGb.trim() && cap === null) {
      setError("The transfer cap has to be a number of GB above zero.");
      return;
    }

    setPending(true);

    const response = await fetch("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileIds,
        folderIds,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        password: passwordOn ? password : undefined,
        // Never null here: "Keep current" only exists when editing.
        expiry: expiry ?? undefined,
        maxDownloads: downloads,
        egressLimitBytes: cap === null ? null : Math.round(cap * GB),
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
      setError(body?.error ?? "Could not create the link.");
      return;
    }

    // The keys ride in the fragment, which is why they are appended here and
    // never sent in the request that created the share.
    setCreated({
      url: `${window.location.origin}${body.url}${encodeKeyFragment(keys.known)}`,
      password: passwordOn ? password : null,
      summary,
    });
    onCreated?.();
    router.refresh();
  }

  if (created) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        {heading && (
          <div className="flex flex-col gap-1.5">
            <span className="data uppercase tracking-[0.06em] text-accent">
              Ready
            </span>
            <h2
              role="status"
              className="font-serif text-[30px] font-medium leading-tight tracking-[-0.02em] text-fg"
            >
              Your link is ready
            </h2>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor={`${formId}-url`} className="label-caps">
            Link
          </label>
          <div className="flex gap-2">
            <Input
              id={`${formId}-url`}
              readOnly
              value={created.url}
              onFocus={(event) => event.target.select()}
              className="h-11 font-mono text-[13px] sm:text-[13px]"
            />
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={() => copy(created.url, "link")}
            >
              {copied === "link" ? (
                <IconCheck className="size-4" />
              ) : (
                <Copy aria-hidden="true" className="size-4" />
              )}
              {copied === "link" ? "Copied" : "Copy link"}
            </Button>
            {/*
              Links get sent to phones. A code on this screen saves typing a
              22-character token into one. Offered, not shown by default, so
              the link itself stays the first thing on the screen.
            */}
            <Button
              type="button"
              variant="default"
              size="icon"
              className="size-11"
              aria-label={showQr ? "Hide QR code" : "Show QR code"}
              aria-expanded={showQr}
              onClick={() => setShowQr(!showQr)}
            >
              <QrIcon aria-hidden="true" className="size-[18px]" />
            </Button>
          </div>

          {keys.known.length > 0 && (
            <p className="text-[13px] leading-relaxed text-e2e">
              The part after # is the decryption key. Browsers never send it to
              the server, so a link that loses it cannot be repaired — not even
              by you. Send it whole.
            </p>
          )}

          {showQr && (
            <div className="mt-2 flex flex-col items-center gap-2">
              <QrCode
                value={created.url}
                label="QR code for this link"
                className="size-48 rounded-lg"
              />
              <p className="text-center text-[13px] text-fg-subtle">
                Anyone who scans this has the link. Show it only to the person
                it is for.
              </p>
            </div>
          )}
        </div>

        {created.password && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-warn-soft px-4 py-3.5">
            <LockKeyhole
              aria-hidden="true"
              className="size-[18px] shrink-0 text-warn"
              strokeWidth={1.75}
            />
            <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
              <span className="text-sm font-semibold text-fg">
                Send the password another way
              </span>
              <span className="text-[13px] leading-relaxed text-fg-muted">
                A text message or a call. If both travel together, a leak of one
                is a leak of both.
              </span>
            </div>
            <span className="ml-auto flex items-center gap-1">
              <span className="font-mono text-sm text-fg">
                {created.password}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Copy password"
                onClick={() => copy(created.password ?? "", "password")}
              >
                {copied === "password" ? (
                  <IconCheck className="size-4" />
                ) : (
                  <Copy aria-hidden="true" className="size-4" />
                )}
              </Button>
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-line pt-5">
          <span className="label-caps">What this link allows</span>
          <p className="text-pretty font-serif text-[18px] leading-relaxed text-fg-muted">
            {created.summary}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="link" onClick={onAgain}>
            Make another
          </Button>
          <span className="ml-auto flex gap-2">
            <Button asChild variant="default">
              <Link href="/dashboard/links">Open in shared links</Link>
            </Button>
            <Button type="button" variant="primary" onClick={onDone}>
              Done
            </Button>
          </span>
        </div>
      </div>
    );
  }

  const nothing = fileIds.length + folderIds.length === 0;

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_300px]"
    >
      <div className="flex min-w-0 flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-name`}>
              Link name{" "}
              <span className="font-normal text-fg-subtle">(optional)</span>
            </Label>
            <Input
              id={`${formId}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Masters for review"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-description`}>
              Note for the recipient{" "}
              <span className="font-normal text-fg-subtle">(optional)</span>
            </Label>
            <Input
              id={`${formId}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              placeholder="Shown at the top of their page"
              autoComplete="off"
            />
          </div>
        </div>

        <fieldset className="min-w-0">
          <legend className="label-caps mb-2.5">Start from</legend>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            {COMPOSER_PRESETS.map((option) => (
              <label
                key={option.id}
                className="relative flex cursor-pointer flex-col gap-1 rounded-xl border border-line bg-ground px-3.5 py-3 transition-colors hover:border-line-strong has-checked:border-accent has-checked:bg-accent-soft has-checked:shadow-[inset_0_0_0_1px_var(--color-accent)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
              >
                <input
                  type="radio"
                  name={`${formId}-preset`}
                  value={option.id}
                  checked={preset === option.id}
                  onChange={() => applyPreset(option)}
                  className="sr-only"
                />
                <span className="font-serif text-base font-semibold leading-snug text-fg">
                  {option.label}
                </span>
                <span className="data text-[11.5px] leading-snug text-fg-subtle">
                  {option.summary}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <ExpiryField
          key={expiryRound}
          defaultPreset={expiryDefault}
          onChange={setExpiry}
        />

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div className={BOX}>
            <div className="flex items-center gap-2.5">
              <span id={`${formId}-pw`} className="text-[13.5px] font-medium">
                Password
              </span>
              <Switch
                checked={passwordOn}
                onCheckedChange={(next) => {
                  setPasswordOn(next);
                  if (next && !password) setPassword(generatePassword());
                }}
                aria-labelledby={`${formId}-pw`}
                className="ml-auto"
              />
            </div>
            {passwordOn ? (
              <>
                <div className="flex h-9 items-center gap-1 rounded-lg border border-field-edge bg-paper pl-2.5 pr-1 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent">
                  <input
                    aria-label="Password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-full min-w-0 flex-1 bg-transparent font-mono text-base text-fg outline-none sm:text-[13px]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-accent"
                    onClick={() => setPassword(generatePassword())}
                  >
                    Generate
                  </Button>
                </div>
                <span className="text-[13px] leading-relaxed text-fg-subtle">
                  Send it separately from the link. After five wrong tries, each
                  further try has to wait longer.
                </span>
              </>
            ) : (
              <span className="text-[13px] leading-relaxed text-fg-subtle">
                Anyone holding the link can open it.
              </span>
            )}
          </div>

          <div className={BOX}>
            <div className="flex items-center gap-2.5">
              <span id={`${formId}-dl`} className="text-[13.5px] font-medium">
                Download limit
              </span>
              <fieldset
                aria-labelledby={`${formId}-dl`}
                className="ml-auto flex items-center overflow-hidden rounded-lg border border-field-edge bg-paper focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent"
              >
                <button
                  type="button"
                  aria-label="Fewer downloads"
                  onClick={() => stepDownloads(-1)}
                  disabled={downloads === null}
                  className="grid h-8 w-8 place-items-center text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
                >
                  <Minus aria-hidden="true" className="size-3.5" />
                </button>
                <input
                  aria-label="Downloads allowed"
                  inputMode="numeric"
                  value={maxDownloads}
                  onChange={(event) =>
                    setMaxDownloads(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="No limit"
                  className="data h-8 w-[4.5rem] bg-transparent text-center text-base text-fg outline-none placeholder:text-fg-subtle sm:text-[12.5px]"
                />
                <button
                  type="button"
                  aria-label="More downloads"
                  onClick={() => stepDownloads(1)}
                  className="grid h-8 w-8 place-items-center text-fg-muted transition-colors hover:text-fg"
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                </button>
              </fieldset>
            </div>
            <div className="flex items-center gap-2.5">
              <label
                htmlFor={`${formId}-cap`}
                className="text-[13.5px] font-medium"
              >
                Transfer cap
              </label>
              <div className="ml-auto flex h-8 w-[8.5rem] items-center gap-1.5 rounded-lg border border-field-edge bg-paper px-2.5 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent">
                <input
                  id={`${formId}-cap`}
                  inputMode="decimal"
                  value={capGb}
                  onChange={(event) => setCapGb(event.target.value)}
                  placeholder="No cap"
                  autoComplete="off"
                  className="data h-full min-w-0 flex-1 bg-transparent text-end text-base text-fg outline-none placeholder:text-fg-subtle sm:text-[12.5px]"
                />
                {capGb.trim() && (
                  <span className="data text-fg-subtle">GB</span>
                )}
              </div>
            </div>
            <span className="text-[13px] leading-relaxed text-fg-subtle">
              Whichever limit is reached first ends the link.
            </span>
          </div>
        </div>

        {encryptedFileIds.length > 0 && (
          <div className="flex gap-3 rounded-xl bg-e2e-soft p-3.5 sm:p-4">
            <KeyRound
              aria-hidden="true"
              className="mt-0.5 size-[18px] shrink-0 text-e2e"
              strokeWidth={1.75}
            />
            <div className="flex flex-col gap-1">
              <span className="text-[13.5px] font-medium text-fg">
                End-to-end encrypted
              </span>
              <span className="text-[13px] leading-relaxed text-fg-muted">
                {encryptedFileIds.length === fileIds.length
                  ? "These files were"
                  : `${encryptedFileIds.length} of these files ${encryptedFileIds.length === 1 ? "was" : "were"}`}{" "}
                encrypted in the browser before upload. The key rides in the
                link, after the #, which browsers never send to the server.
              </span>
            </div>
          </div>
        )}

        {/*
          A share of a file this browser cannot decrypt would produce a link
          that silently fails for the recipient. Say so before it is made, not
          after.
        */}
        {keys.missing.length > 0 && (
          <p className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-[13px] leading-relaxed text-fg">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warn"
              strokeWidth={1.75}
            />
            <span>
              <span className="font-medium">
                {keys.missing.length} encrypted{" "}
                {keys.missing.length === 1 ? "file was" : "files were"} uploaded
                from another browser.
              </span>{" "}
              Their keys are not here, so this link cannot carry them and the
              recipient will get bytes they cannot read. Make the link from the
              browser that uploaded them, or leave them out.
            </span>
          </p>
        )}

        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={moreOpen}
            aria-controls={`${formId}-more`}
            onClick={() => setMoreOpen(!moreOpen)}
            className="-ml-2.5 h-auto min-h-8 flex-wrap self-start py-1"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-3.5 transition-transform motion-reduce:transition-none",
                moreOpen && "rotate-90",
              )}
            />
            More options
            <span className="hidden font-normal text-fg-subtle sm:inline">
              Preview only · Email on download · Address allow list
            </span>
          </Button>

          {moreOpen && (
            <div
              id={`${formId}-more`}
              className="flex flex-col gap-4 border-l border-line pl-4 sm:ml-1.5"
            >
              <label className="flex items-center gap-2.5 text-[13.5px] text-fg">
                <input
                  type="checkbox"
                  checked={viewOnly}
                  onChange={(event) => setViewOnly(event.target.checked)}
                  className="size-4 shrink-0 accent-accent"
                />
                Preview only — recipients can view but not download
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
            </div>
          )}
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-6 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        {files ?? (
          <section className="flex flex-col gap-1.5">
            <h3 className="label-caps">Sharing</h3>
            <p className="text-sm text-fg">
              {nothing
                ? "Nothing selected"
                : describeItems(fileIds.length, folderIds.length).replace(
                    /^these |^this /,
                    "",
                  )}
            </p>
            {folderIds.length > 0 && (
              <p className="text-[13px] leading-relaxed text-fg-subtle">
                Folders are shared as they change: a file added to one later is
                part of the link from that moment.
              </p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="label-caps">What this link allows</h3>
          <p
            aria-live="polite"
            className="text-pretty font-serif text-[18px] leading-relaxed text-fg"
          >
            {nothing ? "Add something to share first." : summary}
          </p>
          <p className="text-[13px] leading-relaxed text-fg-subtle">
            Every download and wrong password is recorded against the link.
          </p>
        </section>

        <section
          aria-label="What the recipient sees"
          className="flex flex-col gap-2.5 lg:mt-auto"
        >
          <span className="label-caps">They’ll see</span>
          <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-paper p-4">
            <span className="break-words font-serif text-[21px] font-medium leading-tight tracking-[-0.015em] text-fg">
              {name.trim() ||
                `${fileIds.length} file${fileIds.length === 1 ? "" : "s"} for you`}
            </span>
            {description.trim() && (
              <span className="break-words text-[13px] leading-relaxed text-fg-subtle">
                {description}
              </span>
            )}
            <span className="data text-fg-subtle">
              {[
                passwordOn && "password",
                ends === null ? "no end date" : mounted && `until ${ends}`,
                downloads !== null &&
                  !viewOnly &&
                  `${downloads} download${downloads === 1 ? "" : "s"}`,
                viewOnly && "preview only",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </section>
      </aside>

      <div className="flex flex-col gap-3 border-t border-line pt-4 lg:col-span-2">
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-fg"
          >
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-fg-subtle">
            {blocked ??
              "You can change these limits later, or revoke the link at any time."}
          </span>
          <span className="ml-auto flex gap-2">
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={pending || nothing || blocked !== null}
              className="px-5"
            >
              {pending ? "Creating…" : "Create link"}
            </Button>
          </span>
        </div>
      </div>
    </form>
  );
}
