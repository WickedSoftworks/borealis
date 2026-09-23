"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorSlab, Notice } from "@/components/world/notice";
import { StateTag } from "@/components/world/panel";
import { authClient } from "@/lib/authClient";

export type PasskeyRow = {
  id: string;
  label: string;
  createdAt: string | null;
  /** Synced through a password manager or platform account, not bound to one device. */
  synced: boolean;
};

/**
 * Passkeys: sign in with the device's own lock — fingerprint, face, PIN —
 * instead of a password.
 *
 * Adding one needs a recent sign-in (better-auth refuses a session older than
 * a day), so a borrowed, long-open browser cannot quietly enrol its own
 * credential on someone else's account. The copy says what a passkey skips,
 * because it does skip the authenticator-app step: it checks the person
 * itself, which is the point of it (lib/auth.ts refuses ones that don't).
 */
export function PasskeysPanel({ passkeys }: { passkeys: PasskeyRow[] }) {
  const router = useRouter();
  const id = useId();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Only knowable in the browser; null renders nothing rather than guessing.
  useEffect(() => {
    setSupported(typeof window.PublicKeyCredential === "function");
  }, []);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy("add");
    setError(null);
    setNotice(null);

    const result = await authClient.passkey.addPasskey({
      name: name.trim() || undefined,
    });

    setBusy(null);

    if (result.error) {
      setError(addError(result.error));
      return;
    }

    setName("");
    setNotice("Passkey added. You can sign in with it from the sign-in page.");
    router.refresh();
  }

  async function remove(passkey: PasskeyRow) {
    setBusy(passkey.id);
    setError(null);
    setNotice(null);

    const result = await authClient.passkey.deletePasskey({ id: passkey.id });

    setBusy(null);

    if (result.error) {
      setError(result.error.message ?? "Could not remove that passkey.");
      return;
    }

    // The credential still sits in the device or password manager; only this
    // server has forgotten it. Say so, or people wonder why it still appears.
    setNotice(
      `Removed “${passkey.label}”. It can no longer sign in here — you can also delete it from the device or password manager that holds it.`,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.75rem] leading-relaxed text-ink-60">
        A passkey signs you in with this device&apos;s lock — fingerprint, face,
        or PIN — instead of a password. It skips the authenticator-app code,
        because the passkey itself checks that it is you. Passkeys belong to
        this instance&apos;s address; if it moves to a new one, they stop
        working and you sign in with your password again.
      </p>

      {passkeys.length > 0 && (
        <ul className="border border-dotted border-ink-20">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-dotted border-ink-20 px-3 py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] text-ink-80">
                  {passkey.label}
                </span>
                {passkey.createdAt && (
                  <span className="block text-[0.6875rem] tabular-nums text-ink-60">
                    added{" "}
                    {new Date(passkey.createdAt).toLocaleDateString(undefined, {
                      dateStyle: "medium",
                    })}
                  </span>
                )}
              </span>

              <StateTag tone="quiet">
                {passkey.synced ? "Synced" : "This device only"}
              </StateTag>

              <Button
                variant="quiet"
                size="sm"
                disabled={busy !== null}
                onClick={() => remove(passkey)}
              >
                {busy === passkey.id ? "…" : "Remove"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {supported === false ? (
        <p className="text-[0.75rem] leading-relaxed text-ink-60">
          This browser can&apos;t create passkeys.
        </p>
      ) : supported ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>Name (optional)</Label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Work laptop"
              maxLength={60}
              autoComplete="off"
            />
          </div>
          <Button type="submit" variant="default" disabled={busy !== null}>
            {busy === "add" ? "Waiting for the device…" : "Add a passkey"}
          </Button>
        </form>
      ) : null}

      <ErrorSlab>{error}</ErrorSlab>
      <Notice>{notice}</Notice>
    </div>
  );
}

function addError(error: { code?: string; message?: string; status: number }) {
  if (error.code === "SESSION_NOT_FRESH") {
    return "Adding a passkey needs a recent sign-in. Sign out, sign back in, and try again.";
  }

  // Browsers report "cancelled", "timed out", and "this device can't verify
  // you" as the same NotAllowedError, which the library passes through under
  // this code. The last is what a PIN-less security key gets, because
  // registration asks for user verification (lib/auth.ts).
  if (
    error.code === "ERROR_CEREMONY_ABORTED" ||
    error.code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"
  ) {
    return "Nothing was added — it was cancelled, it timed out, or the device can't check it's you with a PIN, fingerprint, or face.";
  }

  if (error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return "That device already has a passkey for this account.";
  }

  return error.message ?? "Could not add the passkey.";
}
