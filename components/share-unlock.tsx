"use client";

import { CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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
  const [shown, setShown] = useState(false);

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
      // The lockout's own message says how long to wait; say it verbatim
      // rather than letting a locked link read like one more wrong guess.
      const body = await response.json().catch(() => null);
      setError(
        response.status === 429
          ? (body?.error ??
              "Too many wrong passwords for this link. Wait a few minutes and try again.")
          : "That password didn't match. Check with whoever sent you the link.",
      );
      return;
    }

    router.refresh();
  }

  return (
    <main className="flex flex-1 flex-col justify-center gap-7">
      <div className="flex flex-col gap-2.5">
        <span className="stamp rise">Shared with you · password needed</span>
        <h1
          className="rise text-balance break-words font-serif text-[34px] font-medium leading-[1.15] tracking-[-0.02em] text-fg sm:text-[40px]"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          {name ?? "A locked link"}
        </h1>
      </div>

      <form
        onSubmit={onSubmit}
        className="rise flex flex-col gap-3"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="share-password">Password</Label>
          <div className="flex h-12 items-center gap-1 rounded-lg border border-field-edge bg-paper pl-3.5 pr-1 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent has-aria-invalid:border-danger">
            <input
              id="share-password"
              type={shown ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error !== null}
              aria-describedby="share-password-hint"
              // biome-ignore lint/a11y/noAutofocus: the field is the only thing on the page to do
              autoFocus
              required
              className="h-full min-w-0 flex-1 bg-transparent text-base text-fg outline-none"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10"
              aria-pressed={shown}
              onClick={() => setShown(!shown)}
            >
              {shown ? "Hide" : "Show"}
            </Button>
          </div>

          {error ? (
            <p
              id="share-password-hint"
              role="alert"
              className="flex gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm leading-relaxed text-fg"
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-danger"
                strokeWidth={1.75}
              />
              {error}
            </p>
          ) : (
            <p
              id="share-password-hint"
              className="text-sm leading-relaxed text-fg-subtle"
            >
              Whoever sent the link should have sent the password separately, by
              text or another app.
            </p>
          )}
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="h-12 text-base"
          disabled={pending}
        >
          {pending ? "Checking…" : "Unlock"}
        </Button>
      </form>
    </main>
  );
}
