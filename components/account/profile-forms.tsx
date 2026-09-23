"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorSlab, Notice } from "@/components/world/notice";
import { authClient } from "@/lib/authClient";

/** Display name. What other people see beside your invitations and files. */
export function NameForm({ name }: { name: string }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const result = await authClient.updateUser({ name: value.trim() });

    setPending(false);

    if (result.error) {
      setError(result.error.message ?? "Could not save your name.");
      return;
    }

    setNotice("Saved.");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>Name</Label>
        <div className="flex gap-2">
          <Input
            id={id}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={100}
            autoComplete="name"
            required
          />
          <Button
            type="submit"
            disabled={pending || value.trim() === name || !value.trim()}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      <ErrorSlab>{error}</ErrorSlab>
      <Notice>{notice}</Notice>
    </form>
  );
}

/**
 * Change the address. A confirmed address is confirmed again from where it is
 * now before anything moves — a stolen session must not be able to redirect
 * the account's password resets to the thief (lib/auth.ts, `changeEmail`).
 */
export function EmailForm({
  email,
  verified,
}: {
  email: string;
  verified: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const result = await authClient.changeEmail({
      newEmail: value.trim(),
      callbackURL: "/dashboard/account",
    });

    setPending(false);

    if (result.error) {
      setError(result.error.message ?? "Could not change your email.");
      return;
    }

    // Worded conditionally on purpose: better-auth answers an address that
    // already belongs to another account with the same success, so as not to
    // confirm that account exists — and this message must not confirm it
    // either.
    setValue("");
    setNotice(
      verified
        ? `If ${value.trim()} is free, a confirmation link is on its way to ${email}. Nothing changes until you open it; then the new address is asked to confirm too.`
        : `If ${value.trim()} is free, your address is now that, and a confirmation link is on its way there. Until you open it, password reset stays off.`,
    );
    router.refresh();
  }

  async function resend() {
    setError(null);
    const result = await authClient.sendVerificationEmail({
      email,
      callbackURL: "/dashboard/account",
    });

    if (result.error) {
      setError(result.error.message ?? "Could not send the link.");
      return;
    }

    setNotice(`A confirmation link is on its way to ${email}.`);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.8125rem] text-ink-80">
        {email}{" "}
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-ink-60">
          {verified ? "· confirmed" : "· not confirmed"}
        </span>
      </p>

      {!verified && (
        <p className="text-[0.75rem] leading-relaxed text-ink-60">
          Until this address is confirmed, it cannot be used to reset your
          password.{" "}
          <button
            type="button"
            onClick={resend}
            className="underline underline-offset-4 hover:text-ink-100"
          >
            Send the link again
          </button>
        </p>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-1.5">
        <Label htmlFor={id}>New email</Label>
        <div className="flex gap-2">
          <Input
            id={id}
            type="email"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="email"
            required
          />
          <Button type="submit" disabled={pending || !value.trim()}>
            {pending ? "Sending…" : "Change"}
          </Button>
        </div>
      </form>

      <ErrorSlab>{error}</ErrorSlab>
      <Notice>{notice}</Notice>
    </div>
  );
}

/** Change the password, optionally ending every other session with it. */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const id = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!hasPassword) {
    return (
      <p className="text-[0.75rem] leading-relaxed text-ink-60">
        This account signs in through a provider and has no password here. To
        add one, use{" "}
        <a
          href="/reset"
          className="underline underline-offset-4 hover:text-ink-100"
        >
          password reset
        </a>{" "}
        with a confirmed address.
      </p>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (next !== confirm) {
      setError("Those two new passwords don't match.");
      return;
    }

    setPending(true);

    const result = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: signOutOthers,
    });

    setPending(false);

    if (result.error) {
      setError(
        result.error.message ??
          "That didn't work. Check your current password.",
      );
      return;
    }

    setCurrent("");
    setNext("");
    setConfirm("");
    setNotice(
      signOutOthers
        ? "Password changed. Every other session was signed out."
        : "Password changed.",
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-current`}>Current password</Label>
        <Input
          id={`${id}-current`}
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-new`}>New password</Label>
          <Input
            id={`${id}-new`}
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-confirm`}>Repeat it</Label>
          <Input
            id={`${id}-confirm`}
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
      </div>

      <label className="flex items-center gap-2.5 text-[0.75rem] text-ink-60">
        <input
          type="checkbox"
          checked={signOutOthers}
          onChange={(event) => setSignOutOthers(event.target.checked)}
          className="size-3.5 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100"
        />
        Sign out everywhere else
      </label>

      <ErrorSlab>{error}</ErrorSlab>
      <Notice>{notice}</Notice>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
