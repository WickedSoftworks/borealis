"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlyphText } from "@/components/world/glyph-text";
import { authClient } from "@/lib/authClient";
import type { EnabledProvider } from "@/lib/socialProviders";

type Mode = "signin" | "signup" | "second-factor";

export default function Login({ providers }: { providers: EnabledProvider[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);

  /**
   * Park the code in a cookie before anything else. Signing up through a social
   * provider leaves this page entirely, so the code has to survive the round
   * trip somewhere other than component state. The authoritative check still
   * happens server-side when the account is created.
   */
  async function claimInvite(): Promise<boolean> {
    const response = await fetch("/api/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: inviteCode }),
    });

    if (response.ok) return true;

    const body = await response.json().catch(() => null);
    setError(body?.error ?? "That invitation code isn't valid.");
    return false;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    if (mode === "signup" && !(await claimInvite())) {
      setPending(false);
      return;
    }

    const result =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ name, email, password });

    setPending(false);

    if (result.error) {
      setError(
        result.error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : (result.error.message ??
              "That didn't work. Check the details and try again."),
      );
      return;
    }

    // The password was right and the account has two-step sign-in: nothing
    // is signed in yet, and the second step happens here, in place.
    if (
      result.data &&
      "twoFactorRedirect" in result.data &&
      result.data.twoFactorRedirect
    ) {
      setMode("second-factor");
      setPassword("");
      return;
    }

    router.push(next);
    router.refresh();
  }

  async function onSecondFactor(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const result = useBackup
      ? await authClient.twoFactor.verifyBackupCode({
          code: code.trim(),
          trustDevice,
        })
      : await authClient.twoFactor.verifyTotp({
          code: code.trim(),
          trustDevice,
        });

    setPending(false);

    if (result.error) {
      setError(
        result.error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : useBackup
            ? "That backup code didn't work. Each one works once."
            : "That code didn't match. Codes change every 30 seconds — try the current one.",
      );
      return;
    }

    router.push(next);
    router.refresh();
  }

  async function onSocial(providerId: string) {
    setError(null);

    // The same gate on the social path — otherwise "Continue with GitHub"
    // would be an open door straight around the invitation requirement.
    if (mode === "signup" && !(await claimInvite())) return;

    if (providerId === "oidc") {
      await authClient.signIn.oauth2({ providerId: "oidc", callbackURL: next });
      return;
    }

    await authClient.signIn.social({
      provider: providerId as "github" | "google" | "discord" | "microsoft",
      callbackURL: next,
    });
  }

  return (
    <div className="w-full max-w-sm">
      <GlyphText maxCellSize={5} className="mb-8">
        BOREALIS
      </GlyphText>

      {mode === "second-factor" ? (
        <div className="border border-dotted border-ink-20 p-4">
          <h1 className="mb-4 text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
            Two-step sign-in
          </h1>

          <form onSubmit={onSecondFactor} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="second-factor">
                {useBackup ? "Backup code" : "Code from your authenticator app"}
              </Label>
              <Input
                id="second-factor"
                value={code}
                onChange={(event) =>
                  setCode(
                    useBackup
                      ? event.target.value
                      : event.target.value.replace(/\D/g, ""),
                  )
                }
                inputMode={useBackup ? "text" : "numeric"}
                autoComplete="one-time-code"
                maxLength={useBackup ? 32 : 6}
                autoFocus
                required
              />
            </div>

            <label className="flex items-center gap-2.5 text-[0.75rem] text-ink-60">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(event) => setTrustDevice(event.target.checked)}
                className="size-3.5 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100"
              />
              Don&apos;t ask again on this browser for 30 days
            </label>

            {error && (
              <p
                role="alert"
                className="bg-ink-100 px-2 py-1 text-[0.75rem] font-bold text-ground"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              disabled={pending || !code.trim()}
            >
              {pending ? "Checking…" : "Continue"}
            </Button>
          </form>

          <button
            type="button"
            className="mt-4 text-[0.75rem] text-ink-60 underline underline-offset-4 transition-colors hover:text-ink-100"
            onClick={() => {
              setUseBackup(!useBackup);
              setCode("");
              setError(null);
            }}
          >
            {useBackup
              ? "Use the authenticator app instead"
              : "Lost your phone? Use a backup code"}
          </button>
        </div>
      ) : (
        <div className="border border-dotted border-ink-20 p-4">
          <h1 className="mb-4 text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {mode === "signup" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="invite">Invitation code</Label>
                  <Input
                    id="invite"
                    value={inviteCode}
                    onChange={(event) =>
                      setInviteCode(event.target.value.toUpperCase())
                    }
                    placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="invite-hint"
                    required
                  />
                  <p id="invite-hint" className="text-[0.6875rem] text-ink-60">
                    This instance is invitation-only. Ask whoever runs it for a
                    code.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    required
                  />
                </div>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                required
              />
            </div>

            {error && (
              <p
                role="alert"
                className="bg-ink-100 px-2 py-1 text-[0.75rem] font-bold text-ground"
              >
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" disabled={pending}>
              {pending
                ? "Working…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>

          {providers.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 border-t border-dotted border-ink-20 pt-4">
              {providers.map((provider) => (
                <Button
                  key={provider.id}
                  type="button"
                  variant="default"
                  onClick={() => onSocial(provider.id)}
                >
                  Continue with {provider.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {mode !== "second-factor" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="text-[0.75rem] text-ink-60 underline underline-offset-4 transition-colors hover:text-ink-100"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
            }}
          >
            {mode === "signin"
              ? "Need an account?"
              : "Already have an account?"}
          </button>

          {mode === "signin" && (
            <Link
              href="/reset"
              className="text-[0.75rem] text-ink-60 underline underline-offset-4 transition-colors hover:text-ink-100"
            >
              Forgot password?
            </Link>
          )}

          <ThemeToggle className="ml-auto" />
        </div>
      )}
    </div>
  );
}
