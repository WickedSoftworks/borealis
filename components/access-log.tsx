import { IconDownload, IconLock } from "@/components/world/icons";
import { StateTag } from "@/components/world/panel";
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
};

const ACTION_LABEL: Record<string, string> = {
  DOWNLOAD: "Downloaded",
  VIEW: "Opened",
  UNLOCK_FAIL: "Wrong password",
  UPLOAD: "Uploaded",
};

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The access log.
 *
 * The product's whole claim is that a leaked link is a bounded, *observed*
 * event — so the record has to be visible, not merely written. Failed password
 * attempts sit in the same stream as downloads because a run of them is the
 * signal that a link is being probed.
 */
export function AccessLog({ entries }: { entries: AccessRow[] }) {
  if (entries.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[0.75rem] text-ink-60">
        Nothing has been fetched yet. Every download and failed password attempt
        will appear here.
      </p>
    );
  }

  return (
    <ul className="font-mono">
      {entries.map((entry) => {
        const failed = entry.action === "UNLOCK_FAIL";

        return (
          <li
            key={entry.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-dotted border-ink-20 py-2 last:border-b-0"
          >
            <span className="w-16 shrink-0 text-[0.6875rem] tabular-nums text-ink-60">
              {timeAgo(entry.createdAt)}
            </span>

            <span className="shrink-0">
              {failed ? (
                <StateTag tone="alarm">
                  <IconLock className="mr-1 inline size-3 align-[-2px]" />
                  {ACTION_LABEL[entry.action]}
                </StateTag>
              ) : (
                <StateTag tone="quiet">
                  <IconDownload className="mr-1 inline size-3 align-[-2px]" />
                  {ACTION_LABEL[entry.action] ?? entry.action}
                </StateTag>
              )}
            </span>

            {/*
              The filename identifies the row, so it keeps the width. Address
              and size drop to their own line on a phone rather than crushing
              it — previously a null address held full width while the name
              truncated to two characters.
            */}
            <span className="min-w-0 basis-full truncate text-[0.8125rem] text-ink-80 sm:basis-auto sm:flex-1">
              {entry.fileName ?? entry.shareName ?? `/s/${entry.shareToken}`}
            </span>

            <span className="shrink-0 text-[0.6875rem] tabular-nums text-ink-60">
              {entry.ipAddress ?? "address not recorded"}
            </span>

            {entry.bytesServed > 0 && (
              <span className="shrink-0 text-[0.6875rem] tabular-nums text-ink-60">
                {formatBytes(entry.bytesServed)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
