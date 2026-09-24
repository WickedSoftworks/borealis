"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorSlab, Notice } from "@/components/world/notice";
import { StateTag } from "@/components/world/panel";
import { authClient } from "@/lib/authClient";

type Stage =
  | { kind: "idle" }
  | { kind: "enrolling"; totpURI: string; qrSvg: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

/**
 * Two-step sign-in with an authenticator app (TOTP).
 *
 * Enrolment is three steps and all three are on screen: confirm the password,
 * scan the code, prove it worked by typing one back. Nothing is switched on
 * until that last step succeeds, so a half-finished enrolment cannot lock
 * anyone out. Backup codes are shown once, at enrolment and on regeneration,
 * because the server keeps only what it needs to check them.
 */
export function TwoFactorPanel({
  enabled,
  hasPassword,
}: {
  enabled: boolean;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!hasPassword) {
    return (
      <p className="text-[0.75rem] leading-relaxed text-ink-60">
        Two-step sign-in protects a password. This account signs in through a
        provider — turn on two-step verification there instead.
      </p>
    );
  }

  async function begin(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const result = await authClient.twoFactor.enable({ password });
    setPending(false);

    if (result.error || result.data?.method !== "totp") {
      setError(
        result.error?.message ?? "Could not start. Check your password.",
      );
      return;
    }

    // The QR is drawn server-side-style by the same encoder, here in the
    // browser, from the URI the server just returned; the secret never
    // travels anywhere else.
    const { encode } = await import("uqr");
    const { data, size } = encode(result.data.totpURI, { ecc: "M", border: 4 });
    let path = "";
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++)
        if (data[y][x]) path += `M${x} ${y}h1v1h-1z`;
    }

    setStage({
      kind: "enrolling",
      totpURI: result.data.totpURI,
      qrSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`,
      backupCodes: result.data.backupCodes,
    });
  }

  async function confirmCode(event: React.FormEvent) {
    event.preventDefault();
    if (stage.kind !== "enrolling") return;

    setPending(true);
    setError(null);

    const result = await authClient.twoFactor.verifyTotp({ code: code.trim() });
    setPending(false);

    if (result.error) {
      setError(
        result.error.message ??
          "That code did not match. Check the time on your phone and try the next one.",
      );
      return;
    }

    setCode("");
    setPassword("");
    setStage({ kind: "codes", backupCodes: stage.backupCodes });
    router.refresh();
  }

  async function disable(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await authClient.twoFactor.disable({ password });
    setPending(false);

    if (result.error) {
      setError(
        result.error.message ?? "Could not turn it off. Check your password.",
      );
      return;
    }

    setPassword("");
    setNotice("Two-step sign-in is off. Your password alone signs you in.");
    router.refresh();
  }

  async function regenerate() {
    setPending(true);
    setError(null);

    const result = await authClient.twoFactor.generateBackupCodes({ password });
    setPending(false);

    if (result.error || !result.data) {
      setError(result.error?.message ?? "Enter your password first.");
      return;
    }

    setPassword("");
    setStage({ kind: "codes", backupCodes: result.data.backupCodes });
  }

  if (stage.kind === "codes") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[0.6875rem] uppercase tracking-[0.22em] text-ink-90">
          Save these backup codes now — they are not shown again
        </p>
        <ul className="grid grid-cols-2 gap-1 bg-ink-00 p-3 font-mono text-[0.8125rem] tracking-[0.12em] text-ink-100 sm:grid-cols-5">
          {stage.backupCodes.map((backup) => (
            <li key={backup}>{backup}</li>
          ))}
        </ul>
        <p className="text-[0.75rem] leading-relaxed text-ink-60">
          Each one signs you in once without your phone. Keep them somewhere
          that is not this computer.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={async () => {
              await navigator.clipboard.writeText(stage.backupCodes.join("\n"));
              setNotice("Copied.");
            }}
          >
            Copy codes
          </Button>
          <Button
            type="button"
            variant="quiet"
            onClick={() => setStage({ kind: "idle" })}
          >
            Done
          </Button>
        </div>
        <Notice>{notice}</Notice>
      </div>
    );
  }

  if (stage.kind === "enrolling") {
    return (
      <form onSubmit={confirmCode} className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div
            className="size-44 shrink-0 border border-ink-40"
            role="img"
            aria-label="QR code to add this account to an authenticator app"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: generated locally from the TOTP URI, contains no input markup
            dangerouslySetInnerHTML={{ __html: stage.qrSvg }}
          />
          <div className="flex flex-col gap-2 text-[0.75rem] leading-relaxed text-ink-60">
            <p>
              Scan this with an authenticator app — any that supports TOTP. If
              you cannot scan, enter this key by hand:
            </p>
            <code className="break-all bg-ink-00 px-2 py-1 text-[0.75rem] text-ink-100">
              {new URL(stage.totpURI).searchParams.get("secret")}
            </code>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-code`}>Six-digit code from the app</Label>
          <div className="flex gap-2">
            <Input
              id={`${id}-code`}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ""))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
            <Button
              type="submit"
              variant="primary"
              disabled={pending || code.length !== 6}
            >
              {pending ? "Checking…" : "Turn on"}
            </Button>
          </div>
        </div>

        <ErrorSlab>{error}</ErrorSlab>

        <Button
          type="button"
          variant="quiet"
          onClick={() => setStage({ kind: "idle" })}
        >
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <StateTag tone={enabled ? "normal" : "quiet"}>
          {enabled ? "On" : "Off"}
        </StateTag>
        <span className="text-[0.75rem] text-ink-60">
          {enabled
            ? "Signing in asks for a code from your authenticator app."
            : "Your password alone signs you in."}
        </span>
      </div>

      <form
        onSubmit={enabled ? disable : begin}
        className="flex flex-col gap-1.5"
      >
        <Label htmlFor={`${id}-password`}>Password</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={`${id}-password`}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="min-w-48 flex-1"
            required
          />
          <Button
            type="submit"
            variant={enabled ? "default" : "primary"}
            disabled={pending || !password}
          >
            {pending ? "…" : enabled ? "Turn off" : "Set up"}
          </Button>
          {enabled && (
            <Button
              type="button"
              variant="quiet"
              disabled={pending || !password}
              onClick={regenerate}
            >
              New backup codes
            </Button>
          )}
        </div>
      </form>

      <ErrorSlab>{error}</ErrorSlab>
      <Notice>{notice}</Notice>
    </div>
  );
}
