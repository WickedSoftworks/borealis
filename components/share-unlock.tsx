"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconLock } from "@/components/world/icons";

export default function ShareUnlock({
  token,
  name,
}: {
  token: string;
  name: string | null;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const response = await fetch(`/api/s/${token}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setPending(false);

    if (!response.ok) {
      setError(
        "That password didn't match. Check with whoever sent you the link.",
      );
      return;
    }

    router.refresh();
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-2.5">
          <span aria-hidden="true" className="size-2 bg-ink-100" />
          <span className="text-[0.6875rem] uppercase tracking-[0.28em] text-ink-60">
            Sent with Borealis
          </span>
        </div>

        <div className="border border-dotted border-ink-20 p-4">
          <div className="flex items-center gap-2">
            <IconLock className="size-4 text-ink-60" />
            <h1 className="text-[0.6875rem] uppercase tracking-[0.22em] text-ink-90">
              Password needed
            </h1>
          </div>

          <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-60">
            {name
              ? `“${name}” is locked. The sender has the password.`
              : "This link is locked. The sender has the password."}
          </p>

          <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-password">Password</Label>
              <Input
                id="share-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
                autoFocus
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
              {pending ? "Checking…" : "Unlock"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
