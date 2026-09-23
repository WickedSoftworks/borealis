"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/authClient";

/**
 * Two states on one route.
 *
 * With a `token` in the URL the visitor arrived from a reset email and sets a
 * new password. Without one they are asking for the email in the first place.
 */
export function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function requestLink(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset",
    });

    setPending(false);
    // Always the same outcome, whether or not that address has an account and
    // whether or not it is verified. Anything else enumerates accounts.
    setSent(true);
  }

  async function setNewPassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }

    setPending(true);
    const result = await authClient.resetPassword({
      newPassword: password,
      token: token ?? undefined,
    });
    setPending(false);

    if (result.error) {
      setError(
        result.error.message ??
          "That link has expired or was already used. Ask for a new one.",
      );
      return;
    }

    router.push("/login");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm">
      <div className="border border-dotted border-ink-20 p-4">
        <h1 className="mb-4 text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
          {token ? "Choose a new password" : "Reset password"}
        </h1>

        {sent ? (
          <div className="flex flex-col gap-4">
            <p className="text-[0.8125rem] leading-relaxed text-ink-80">
              If that address belongs to a confirmed account, a reset link is on
              its way. It expires in an hour.
            </p>
            <p className="text-[0.75rem] leading-relaxed text-ink-60">
              Accounts whose email was never confirmed can&apos;t be reset this
              way — ask whoever runs this instance to reset it from the console.
            </p>
            <Button asChild variant="default">
              <Link href="/login">Back to sign in</Link>
            </Button>
          </div>
        ) : token ? (
          <form onSubmit={setNewPassword} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password">Repeat it</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
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
              {pending ? "Saving…" : "Set password"}
            </Button>
          </form>
        ) : (
          <form onSubmit={requestLink} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
              <p className="text-[0.6875rem] leading-relaxed text-ink-60">
                Only confirmed addresses can be reset by email.
              </p>
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
              {pending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
      </div>

      {!sent && (
        <Link
          href="/login"
          className="mt-4 inline-block text-[0.75rem] text-ink-60 underline underline-offset-4 transition-colors hover:text-ink-100"
        >
          Back to sign in
        </Link>
      )}
    </div>
  );
}
