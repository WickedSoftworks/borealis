"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconCheck } from "@/components/world/icons";
import { StateTag } from "@/components/world/panel";
import { ROLE_ADMIN, ROLE_USER } from "@/lib/roles";

export type InviteRow = {
  id: string;
  grantsRole: string;
  note: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  redeemedAt: string | null;
  createdAt: string;
  redeemedByEmail: string | null;
};

function state(invite: InviteRow) {
  if (invite.redeemedAt) return { label: "Used", tone: "quiet" as const };
  if (invite.revokedAt) return { label: "Revoked", tone: "quiet" as const };
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) {
    return { label: "Expired", tone: "quiet" as const };
  }
  return { label: "Open", tone: "normal" as const };
}

/**
 * Invitation control. Admins and root only.
 *
 * The plaintext code appears exactly once, right after minting — the server
 * stores only a hash, so there is no "show it again". The copy says so, because
 * a user who assumes they can come back for it will lose the code.
 */
export function InvitePanel({
  invites,
  canMintAdmin,
}: {
  invites: InviteRow[];
  canMintAdmin: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [grantsRole, setGrantsRole] = useState(ROLE_USER);
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function mint(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const response = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grantsRole,
        note: note || undefined,
        expiresInDays: expiresInDays ? Number(expiresInDays) : null,
      }),
    });

    setPending(false);
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setError(body?.error ?? "Could not create the invitation.");
      return;
    }

    setMinted(body.code);
    setCopied(false);
    setNote("");
    router.refresh();
  }

  async function revoke(id: string) {
    await fetch(`/api/invites/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {minted && (
        <div className="border border-accent p-3">
          <p className="text-[13px] text-fg">
            Copy this now — it is not stored and cannot be shown again
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="flex-1 bg-raised px-2 py-1.5 text-sm text-fg">
              {minted}
            </code>

            <Button
              type="button"
              variant="primary"
              onClick={async () => {
                await navigator.clipboard.writeText(minted);
                setCopied(true);
              }}
            >
              {copied ? <IconCheck className="size-3.5" /> : null}
              {copied ? "Copied" : "Copy"}
            </Button>

            <Button
              type="button"
              variant="quiet"
              onClick={() => setMinted(null)}
            >
              Done
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={mint} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-40 flex-1 flex-col gap-1.5">
          <Label htmlFor="invite-note">For</Label>
          <Input
            id="invite-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Marcus — mixing"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Grants</Label>
          <select
            id="invite-role"
            value={grantsRole}
            onChange={(event) => setGrantsRole(event.target.value)}
            className="h-10 rounded-lg border border-field-edge bg-paper px-3 text-base text-fg sm:text-sm"
          >
            <option value={ROLE_USER}>User</option>
            {canMintAdmin && <option value={ROLE_ADMIN}>Admin</option>}
          </select>
        </div>

        <div className="flex w-28 flex-col gap-1.5">
          <Label htmlFor="invite-expiry">Valid (days)</Label>
          <Input
            id="invite-expiry"
            type="number"
            min={1}
            max={365}
            value={expiresInDays}
            onChange={(event) => setExpiresInDays(event.target.value)}
          />
        </div>

        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Minting…" : "Mint code"}
        </Button>
      </form>

      {!canMintAdmin && (
        <p className="text-[13px] text-fg-subtle">
          Only root can create admin invitations.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-fg"
        >
          {error}
        </p>
      )}

      {invites.length > 0 && (
        <ul className="border-t border-line pt-1">
          {invites.map((invite) => {
            const status = state(invite);
            const open = status.label === "Open";

            return (
              <li
                key={invite.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0"
              >
                <StateTag tone={status.tone}>{status.label}</StateTag>

                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {invite.note ?? "no label"}
                  {invite.redeemedByEmail && (
                    <span className="text-fg-subtle">
                      {" "}
                      → {invite.redeemedByEmail}
                    </span>
                  )}
                </span>

                <span className="text-[13px] text-fg-subtle">
                  {invite.grantsRole}
                </span>

                {open && (
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => revoke(invite.id)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
