"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSlab, Notice } from "@/components/world/notice";
import { StateTag } from "@/components/world/panel";

export type SessionRow = {
  id: string;
  device: string;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
  current: boolean;
  impersonated: boolean;
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Where this account is signed in.
 *
 * The case this exists for is the one PRODUCT.md names: an instance shared
 * with people you half-trust, and a browser you signed in on once and no
 * longer have. Each row can be ended on its own; "everywhere else" ends all
 * but this one.
 */
export function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function end(url: string, key: string, done: string) {
    setBusy(key);
    setError(null);
    setNotice(null);

    const response = await fetch(url, { method: "DELETE" });
    const body = await response.json().catch(() => null);

    setBusy(null);

    if (!response.ok) {
      setError(body?.error ?? "Could not end that session.");
      return;
    }

    setNotice(done);
    router.refresh();
  }

  const others = sessions.filter((session) => !session.current).length;

  return (
    <div className="flex flex-col gap-3">
      <ul className="border border-dotted border-ink-20">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-dotted border-ink-20 px-3 py-2 last:border-b-0"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem] text-ink-80">
                {session.device}
              </span>
              <span className="block text-[0.6875rem] tabular-nums text-ink-60">
                {session.ipAddress ?? "address not recorded"} · signed in{" "}
                {when(session.createdAt)} · last seen {when(session.updatedAt)}
              </span>
            </span>

            {session.current && <StateTag>This browser</StateTag>}
            {session.impersonated && (
              <StateTag tone="alarm">Impersonated</StateTag>
            )}

            {!session.current && (
              <Button
                variant="quiet"
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  end(
                    `/api/account/sessions/${session.id}`,
                    session.id,
                    "Signed out.",
                  )
                }
              >
                {busy === session.id ? "…" : "Sign out"}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {others > 0 && (
        <div className="flex justify-end">
          <Button
            variant="default"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              end(
                "/api/account/sessions",
                "all",
                `Signed out of ${others} other session${others === 1 ? "" : "s"}.`,
              )
            }
          >
            {busy === "all" ? "…" : "Sign out everywhere else"}
          </Button>
        </div>
      )}

      <ErrorSlab>{error}</ErrorSlab>
      <Notice>{notice}</Notice>
    </div>
  );
}
