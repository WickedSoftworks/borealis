"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateTag } from "@/components/world/panel";
import { formatBytes } from "@/lib/format";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  emailVerified: boolean;
  twoFactor: boolean;
  fileCount: number;
  shareCount: number;
  storedBytes: number;
  /** The account's own quota, if it has one; null means the instance default. */
  quotaBytes: number | null;
};

/**
 * Account list.
 *
 * An admin sees every account but can only act on ordinary users. Root is the
 * only role that can act on an admin — including demoting one — which is the
 * whole reason admins are described as peers rather than a hierarchy.
 *
 * Deleting an account asks for its email to be typed, because it removes
 * every file the account holds and ends every link it made, immediately.
 */
export function AdminUsers({
  users,
  actorId,
  isRootActor,
  defaultQuotaBytes,
}: {
  users: AdminUserRow[];
  actorId: string;
  isRootActor: boolean;
  defaultQuotaBytes: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    mode: "quota" | "delete";
  } | null>(null);
  const [value, setValue] = useState("");

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

    if (!response.ok) {
      setNote(payload?.error ?? "That didn't work.");
      return;
    }

    setNote(null);
    setEditing(null);
    setValue("");
    router.refresh();
  }

  function mayManage(user: AdminUserRow) {
    if (user.id === actorId) return false;
    if (user.role === "root") return false;
    // Only root may act on another admin.
    if (user.role === "admin") return isRootActor;
    return true;
  }

  function limitOf(user: AdminUserRow): number | null {
    return user.quotaBytes ?? defaultQuotaBytes;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul>
        {users.map((user) => {
          const manageable = mayManage(user);
          const limit = limitOf(user);
          const isEditing = editing?.id === user.id;

          return (
            <li
              key={user.id}
              className="flex flex-col gap-2 border-b border-dotted border-ink-20 py-2 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
                {user.twoFactor && <StateTag tone="quiet">2FA</StateTag>}

                <span className="shrink-0 text-[0.6875rem] tabular-nums text-ink-60">
                  {user.fileCount} files · {formatBytes(user.storedBytes)}
                  {limit !== null && ` of ${formatBytes(limit)}`}
                  {user.quotaBytes !== null && " (own)"}
                </span>

                {manageable && (
                  <span className="flex shrink-0 gap-1.5">
                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={busy === user.id}
                      onClick={() =>
                        act(user.id, user.banned ? "unban" : "ban")
                      }
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

                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={busy === user.id}
                      onClick={() => {
                        setEditing({ id: user.id, mode: "quota" });
                        setValue(
                          user.quotaBytes === null
                            ? ""
                            : formatBytes(user.quotaBytes),
                        );
                      }}
                    >
                      Quota
                    </Button>

                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={busy === user.id}
                      onClick={() => {
                        setEditing({ id: user.id, mode: "delete" });
                        setValue("");
                      }}
                    >
                      Delete
                    </Button>
                  </span>
                )}
              </div>

              {isEditing && editing.mode === "quota" && (
                <form
                  className="flex flex-wrap items-center gap-2 pl-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(user.id, "set-quota", {
                      quota: value.trim() === "" ? null : value.trim(),
                    });
                  }}
                >
                  <Input
                    aria-label={`Quota for ${user.email}`}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder={
                      defaultQuotaBytes === null
                        ? "blank = instance default (none)"
                        : `blank = instance default (${formatBytes(defaultQuotaBytes)})`
                    }
                    className="max-w-72"
                    autoFocus
                  />
                  <Button type="submit" size="sm" disabled={busy === user.id}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                  <span className="basis-full text-[0.6875rem] text-ink-60">
                    “50GB”, “500MB”, “unlimited”, or blank for the instance
                    default.
                  </span>
                </form>
              )}

              {isEditing && editing.mode === "delete" && (
                <form
                  className="flex flex-col gap-2 border border-dotted border-ink-40 p-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(user.id, "delete", { confirmEmail: value });
                  }}
                >
                  <p className="text-[0.75rem] leading-relaxed text-ink-80">
                    Removes {user.email}, their {user.fileCount} file
                    {user.fileCount === 1 ? "" : "s"} (
                    {formatBytes(user.storedBytes)}
                    ), and ends their {user.shareCount} link
                    {user.shareCount === 1 ? "" : "s"}. There is no trash for
                    this. Type the email to confirm.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      aria-label="Email, to confirm"
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      placeholder={user.email}
                      className="max-w-72"
                      autoComplete="off"
                      autoFocus
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={
                        busy === user.id ||
                        value.trim().toLowerCase() !== user.email.toLowerCase()
                      }
                    >
                      Delete account
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      size="sm"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      {!isRootActor && (
        <p className="border-t border-dotted border-ink-20 pt-3 text-[0.6875rem] leading-relaxed text-ink-60">
          Other admins are listed but not manageable. Promoting, demoting,
          banning, capping, or deleting an admin is root&apos;s decision alone.
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
