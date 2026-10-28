import { formatBytes } from "@/lib/format";

export type AccessRow = {
  id: string;
  action: string;
  ipAddress: string | null;
  bytesServed: number;
  createdAt: string;
  shareName: string | null;
  shareToken: string;
  fileName: string | null;
  /** UPLOAD rows: who the sender said they were. Self-reported. */
  uploaderName: string | null;
};

export const ACTION_LABEL: Record<string, string> = {
  DOWNLOAD: "Downloaded",
  VIEW: "Viewed",
  UNLOCK_FAIL: "Wrong password",
  UPLOAD: "Uploaded",
  DENIED: "Refused address",
};

/** The two actions that mean someone tried a link they could not open. */
export const ALARM_ACTIONS = new Set(["UNLOCK_FAIL", "DENIED"]);

export function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The access log, as a timeline: when on the left, what on the right, joined
 * by a rail.
 *
 * The product's whole claim is that a leaked link is a bounded, *observed*
 * event — so the record has to be visible, not merely written. Failed password
 * attempts sit in the same stream as downloads because a run of them is the
 * signal that a link is being probed; their dot fills in the warning colour
 * and their words say what happened.
 */
export function AccessLog({ entries }: { entries: AccessRow[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-fg-subtle">
        Nothing has been fetched yet. Every download and failed password attempt
        will appear here.
      </p>
    );
  }

  return (
    <ol className="relative grid grid-cols-[72px_minmax(0,1fr)] gap-x-5 before:absolute before:bottom-2 before:left-[71.5px] before:top-2 before:w-px before:bg-line">
      {entries.map((entry) => {
        const failed = ALARM_ACTIONS.has(entry.action);
        const link = entry.shareName ?? `/s/${entry.shareToken}`;

        // What happened, in a sentence fragment that names its subject.
        const what = failed
          ? `${ACTION_LABEL[entry.action]} on ${link}`
          : entry.fileName
            ? `${ACTION_LABEL[entry.action] ?? entry.action} ${entry.fileName}`
            : entry.action === "DOWNLOAD"
              ? `Downloaded everything from ${link} as a ZIP`
              : `${ACTION_LABEL[entry.action] ?? entry.action} ${link}`;

        const detail = [
          entry.ipAddress ?? "address not recorded",
          entry.fileName && !failed ? link : null,
          entry.bytesServed > 0 ? formatBytes(entry.bytesServed) : null,
        ].filter(Boolean);

        return (
          <li key={entry.id} className="contents">
            <div className="relative pr-3 text-right">
              <time dateTime={entry.createdAt} className="data text-fg-subtle">
                {timeAgo(entry.createdAt)}
              </time>
              <span
                aria-hidden="true"
                className={
                  failed
                    ? "absolute -right-[5px] top-[5px] size-[9px] rounded-full border-[1.5px] border-warn bg-warn"
                    : "absolute -right-[5px] top-[5px] size-[9px] rounded-full border-[1.5px] border-dot bg-ground"
                }
              />
            </div>

            <div className="min-w-0 pb-4">
              <p
                className={
                  failed
                    ? "break-words text-sm font-medium text-warn"
                    : "break-words text-sm font-medium text-fg"
                }
              >
                {what}
                {entry.uploaderName && (
                  <span
                    className="font-normal text-fg-subtle"
                    title="As the sender typed it — not a verified identity"
                  >
                    {" "}
                    · from “{entry.uploaderName}”
                  </span>
                )}
              </p>
              <p className="data break-all text-fg-subtle">
                {detail.join(" · ")}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
