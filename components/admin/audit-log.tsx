import { StateTag } from "@/components/world/panel";

export type AuditRow = {
  id: string;
  action: string;
  actorEmail: string | null;
  targetLabel: string | null;
  detail: string | null;
  ipAddress: string | null;
  createdAt: string;
};

const LABEL: Record<string, string> = {
  USER_BAN: "Banned",
  USER_UNBAN: "Unbanned",
  USER_ROLE: "Changed role",
  USER_QUOTA: "Changed quota",
  USER_DELETE: "Deleted account",
  FILE_DELETE_OTHER: "Deleted a file",
  SETTING_CHANGE: "Changed settings",
  JOB_RETRY: "Retried job",
  JOB_DISCARD: "Discarded job",
  MAIL_TEST: "Sent test email",
};

const DESTRUCTIVE = new Set(["USER_DELETE", "FILE_DELETE_OTHER", "USER_BAN"]);

/** A few of the detail fields, readable, without dumping JSON at the operator. */
function summary(action: string, detail: string | null): string | null {
  if (!detail) return null;

  try {
    const value = JSON.parse(detail) as Record<string, unknown>;

    if (action === "USER_ROLE") return `${value.from} → ${value.to}`;
    if (action === "USER_QUOTA") return `${value.from} → ${value.to}`;
    if (action === "USER_BAN" && value.reason) return `reason: ${value.reason}`;
    if (action === "FILE_DELETE_OTHER") return `owned by ${value.ownerEmail}`;
    if (action === "MAIL_TEST")
      return String(value.error ?? value.response ?? "");
    if (action === "SETTING_CHANGE") {
      return Object.entries(value)
        .map(([key, next]) => `${key} = ${String(next)}`)
        .join("; ");
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * What operators did: the other half of the audit trail. `ShareAccess`
 * records recipients; this records bans, role and quota changes, deleted
 * accounts and files, and settings — by whom, from where, and when.
 */
export function AuditLog({ entries }: { entries: AuditRow[] }) {
  if (entries.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[0.75rem] text-ink-60">
        No operator actions yet. Bans, role changes, deletions of other
        people&apos;s files, and settings changes will be recorded here.
      </p>
    );
  }

  return (
    <ul className="font-mono">
      {entries.map((entry) => {
        const note = summary(entry.action, entry.detail);

        return (
          <li
            key={entry.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-dotted border-ink-20 py-2 last:border-b-0"
          >
            <time
              dateTime={entry.createdAt}
              className="w-36 shrink-0 text-[0.6875rem] tabular-nums text-ink-60"
            >
              {new Date(entry.createdAt).toLocaleString()}
            </time>

            <StateTag tone={DESTRUCTIVE.has(entry.action) ? "alarm" : "quiet"}>
              {LABEL[entry.action] ?? entry.action}
            </StateTag>

            <span className="min-w-0 flex-1 text-[0.8125rem] text-ink-80">
              {entry.targetLabel ?? "—"}
              {note && (
                <span className="block break-words text-[0.6875rem] text-ink-60">
                  {note}
                </span>
              )}
            </span>

            <span className="shrink-0 text-[0.6875rem] text-ink-60">
              {entry.actorEmail ?? "console"}
              {entry.ipAddress ? ` · ${entry.ipAddress}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
