"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSlab } from "@/components/world/notice";

/** The Connect button on /dashboard/connect/discord. */
export function ConnectDiscord({ code }: { code: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setPending(true);
    setError(null);

    const response = await fetch("/api/account/discord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = await response.json().catch(() => null);

    setPending(false);

    if (!response.ok) {
      setError(body?.error ?? "Could not connect Discord.");
      return;
    }

    router.push("/dashboard/account?discord=connected#discord");
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorSlab>{error}</ErrorSlab>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="lg"
          disabled={pending}
          onClick={connect}
        >
          {pending ? "Connecting…" : "Connect"}
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href="/dashboard">Cancel</Link>
        </Button>
      </div>
    </div>
  );
}
