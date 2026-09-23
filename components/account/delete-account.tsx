"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorSlab } from "@/components/world/notice";
import { authClient } from "@/lib/authClient";
import { formatBytes } from "@/lib/format";

/**
 * Delete this account, and everything in it, now.
 *
 * The consequences are stated before the button, in numbers — how many files,
 * how many live links — because "delete account" reads as reversible to
 * anyone who has used a service that keeps a grace period. This one does not:
 * the files, the trash, and every link go with it, and links already sent
 * start answering "not found" to whoever holds them.
 */
export function DeleteAccount({
  email,
  fileCount,
  storedBytes,
  liveLinks,
  hasPassword,
  blocked,
}: {
  email: string;
  fileCount: number;
  storedBytes: number;
  liveLinks: number;
  hasPassword: boolean;
  /** Why this account cannot delete itself, if it cannot. */
  blocked: string | null;
}) {
  const router = useRouter();
  const id = useId();
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (blocked) {
    return (
      <p className="text-[0.75rem] leading-relaxed text-ink-60">{blocked}</p>
    );
  }

  const ready =
    confirm.trim().toLowerCase() === email.toLowerCase() &&
    (!hasPassword || password.length > 0);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;

    setPending(true);
    setError(null);

    const result = await authClient.deleteUser(hasPassword ? { password } : {});

    setPending(false);

    if (result.error) {
      setError(
        result.error.message ??
          (hasPassword
            ? "That password did not match."
            : "Sign out and back in, then try again — deletion needs a recent sign-in."),
      );
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <p className="text-[0.75rem] leading-relaxed text-ink-60">
        <span className="text-ink-90">This cannot be undone.</span> It removes{" "}
        {fileCount} file{fileCount === 1 ? "" : "s"} ({formatBytes(storedBytes)}
        , trash included) and ends {liveLinks} live link
        {liveLinks === 1 ? "" : "s"} — anyone holding one gets “not found” from
        the next request.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-confirm`}>Type your email to confirm</Label>
        <Input
          id={`${id}-confirm`}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder={email}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {hasPassword && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-password`}>Password</Label>
          <Input
            id={`${id}-password`}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </div>
      )}

      <ErrorSlab>{error}</ErrorSlab>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!ready || pending}>
          {pending ? "Deleting…" : "Delete account and everything in it"}
        </Button>
      </div>
    </form>
  );
}
