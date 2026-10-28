"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSlab, Notice } from "@/components/world/notice";

export type DiscordLinkRow = {
  id: string;
  name: string;
  linkedAt: string | null;
};

/**
 * Discord accounts that may act for this one through the slash commands.
 * Connecting starts in Discord (`/connect`); ending it works from either side.
 */
export function DiscordLinks({
  links,
  enabled,
  justConnected,
}: {
  links: DiscordLinkRow[];
  /** Whether this instance has the Discord commands set up at all. */
  enabled: boolean;
  justConnected: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function disconnect(id: string) {
    setBusy(id);
    setError(null);

    const response = await fetch(`/api/account/discord/${id}`, {
      method: "DELETE",
    });
    const body = await response.json().catch(() => null);

    setBusy(null);

    if (!response.ok) {
      setError(body?.error ?? "Could not disconnect.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {justConnected && links.length > 0 && (
        <Notice>
          Connected. Your Discord commands now act for this account.
        </Notice>
      )}

      {links.length === 0 ? (
        <p className="text-sm leading-relaxed text-fg-muted">
          {enabled ? (
            <>
              Run <code className="data">/connect</code> in Discord to send
              files and manage links from there.
            </>
          ) : (
            "This instance doesn't have the Discord commands set up."
          )}
        </p>
      ) : (
        <ul className="border-t border-line">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex flex-wrap items-center gap-3 border-b border-line py-2.5"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-fg">{link.name}</span>
                {link.linkedAt && (
                  <span className="data text-fg-subtle">
                    connected {link.linkedAt.slice(0, 10)}
                  </span>
                )}
              </span>
              <Button
                variant="danger"
                size="sm"
                disabled={busy === link.id}
                onClick={() => disconnect(link.id)}
              >
                {busy === link.id ? "Disconnecting…" : "Disconnect"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ErrorSlab>{error}</ErrorSlab>
    </div>
  );
}
