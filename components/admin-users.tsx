"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StateTag } from "@/components/world/panel";
import { formatBytes } from "@/lib/format";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  emailVerified: boolean;
  fileCount: number;
  shareCount: number;
  storedBytes: number;
};

/**
 * Account list.
 *
 * An admin sees every account but can only act on ordinary users. Root is the
 * only role that can act on an admin — including demoting one — which is the
 * whole reason admins are described as peers rather than a hierarchy.
 */
export function AdminUsers({
  users,
  actorId,
  isRootActor,
}: {
  users: AdminUserRow[];
  actorId: string;
  isRootActor: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function act(
    id: string,
    action: string,
    body: Record<string, unknown> = {},
  ) {
    setBusy(id);

    const response = await fetch(`/api/admin/users/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });

    const payload = await response.json().catch(() => null);
    setBusy(null);
    setNote(response.ok ? null : (payload?.error ?? "That didn't work."));
    router.refresh();
  }

  function mayManage(user: AdminUserRow) {
    if (user.id === actorId) return false;
    if (user.role === "root") return false;
    // Only root may act on another admin.
    if (user.role === "admin") return isRootActor;
    return true;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul>
        {users.map((user) => {
          const manageable = mayManage(user);

          return (
            <li
              key={user.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-dotted border-ink-20 py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-80">
                {user.email}
                {user.id === actorId && (
                  <span className="text-ink-60"> · you</span>
                )}
              </span>

              <StateTag tone={user.role === "user" ? "quiet" : "normal"}>
                {user.role}
              </StateTag>

              {user.banned && <StateTag tone="alarm">Banned</StateTag>}
              {!user.emailVerified && (
                <StateTag tone="quiet">Unverified</StateTag>
              )}

              <span className="shrink-0 text-[0.6875rem] tabular-nums text-ink-60">
                {user.fileCount} files · {formatBytes(user.storedBytes)}
              </span>

              {manageable && (
                <span className="flex shrink-0 gap-1.5">
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={busy === user.id}
                    onClick={() => act(user.id, user.banned ? "unban" : "ban")}
                  >
                    {user.banned ? "Unban" : "Ban"}
                  </Button>

                  {isRootActor && (
                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={busy === user.id}
                      onClick={() =>
                        act(user.id, "set-role", {
                          role: user.role === "admin" ? "user" : "admin",
                        })
                      }
                    >
                      {user.role === "admin" ? "Demote" : "Promote"}
                    </Button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {!isRootActor && (
        <p className="border-t border-dotted border-ink-20 pt-3 text-[0.6875rem] leading-relaxed text-ink-60">
          Other admins are listed but not manageable. Promoting, demoting, or
          banning an admin is root&apos;s decision alone.
        </p>
      )}

      {note && (
        <p
          role="alert"
          className="bg-ink-100 px-2 py-1 text-[0.75rem] font-bold text-ground"
        >
          {note}
        </p>
      )}
    </div>
  );
}
