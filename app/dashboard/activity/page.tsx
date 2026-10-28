import Link from "next/link";
import { ACTION_LABEL, ALARM_ACTIONS, timeAgo } from "@/components/access-log";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconDownload } from "@/components/world/icons";
import { Panel } from "@/components/world/panel";
import {
  ACTIVITY_PAGE_SIZE,
  activityWhere,
  parseActivityFilters,
} from "@/lib/activity";
import { ACCESS_ACTIONS } from "@/lib/constants";
import { db } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import { getSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { describeUserAgent } from "@/lib/user-agent";

export const metadata = {
  title: "Activity",
  robots: { index: false, follow: false },
};

const SELECT =
  "h-10 w-full rounded-lg border border-field-edge bg-paper px-3 text-base text-fg sm:text-sm";

/**
 * Every recorded access to your links: downloads, previews, uploads into
 * collection links, wrong passwords, and refused addresses.
 *
 * The filter is a plain GET form, so it works without JavaScript and every
 * filtered view is a URL an owner can bookmark or send to someone helping
 * them work out what happened. The export takes the same URL.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) return null;

  const raw = await searchParams;
  const get = (name: string) => {
    const value = raw[name];
    return Array.isArray(value) ? value[0] : value;
  };

  const filters = parseActivityFilters(get);
  const where = activityWhere(session.user.id, filters);

  const [total, rows, shares, { auditRetentionDays }] = await Promise.all([
    db.shareAccess.count({ where }),
    db.shareAccess.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * ACTIVITY_PAGE_SIZE,
      take: ACTIVITY_PAGE_SIZE,
      select: {
        id: true,
        action: true,
        ipAddress: true,
        userAgent: true,
        bytesServed: true,
        createdAt: true,
        uploaderName: true,
        share: { select: { id: true, name: true, token: true, type: true } },
        file: { select: { originalName: true } },
      },
    }),
    db.share.findMany({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        token: true,
        type: true,
        revokedAt: true,
      },
    }),
    getSettings(),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));

  // The current filters as a query string, for the export link and paging.
  const query = new URLSearchParams();
  for (const name of ["share", "action", "from", "to"]) {
    const value = get(name);
    if (value) query.set(name, value);
  }

  const pageHref = (page: number) => {
    const next = new URLSearchParams(query);
    if (page > 1) next.set("page", String(page));
    const text = next.toString();
    return text ? `/dashboard/activity?${text}` : "/dashboard/activity";
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-4xl font-medium tracking-[-0.02em]">
          Activity
        </h1>
        <p className="text-[13px] text-fg-subtle">
          Kept for {auditRetentionDays} day{auditRetentionDays === 1 ? "" : "s"}
          , then removed by the hourly sweep.
        </p>
      </div>

      <Panel title="Filter">
        <form
          method="get"
          action="/dashboard/activity"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end"
        >
          <label className="flex flex-col gap-1.5 text-[13px] text-fg-subtle">
            Link
            <select
              name="share"
              defaultValue={filters.shareId ?? ""}
              className={SELECT}
            >
              <option value="">Every link</option>
              {shares.map((share) => (
                <option key={share.id} value={share.id}>
                  {share.name ??
                    `${share.type === "REVERSE" ? "/r/" : "/s/"}${share.token}`}
                  {share.revokedAt ? " (revoked)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-[13px] text-fg-subtle">
            What
            <select
              name="action"
              defaultValue={filters.action ?? ""}
              className={SELECT}
            >
              <option value="">Everything</option>
              {ACCESS_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {ACTION_LABEL[action] ?? action}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1.5 text-[13px] text-fg-subtle">
            <label htmlFor="activity-from">From</label>
            <Input
              id="activity-from"
              type="date"
              name="from"
              defaultValue={get("from") ?? ""}
            />
          </div>

          <div className="flex flex-col gap-1.5 text-[13px] text-fg-subtle">
            <label htmlFor="activity-to">Until</label>
            <Input
              id="activity-to"
              type="date"
              name="to"
              defaultValue={get("to") ?? ""}
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" variant="primary">
              Apply
            </Button>
            <Button asChild variant="quiet">
              <Link href="/dashboard/activity">Clear</Link>
            </Button>
          </div>
        </form>
      </Panel>

      <Panel
        title={`${total} event${total === 1 ? "" : "s"}`}
        actions={
          total > 0 ? (
            <Button asChild variant="quiet" size="sm">
              <a href={`/api/activity/export${query.size ? `?${query}` : ""}`}>
                <IconDownload className="size-3.5" />
                Export CSV
              </a>
            </Button>
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <p className="px-1 py-6 text-center text-[13px] text-fg-subtle">
            Nothing matches. Every download, preview, upload, wrong password,
            and refused address on your links is recorded here.
          </p>
        ) : (
          <ul>
            {rows.map((row) => {
              const alarm = ALARM_ACTIONS.has(row.action);
              const label = ACTION_LABEL[row.action] ?? row.action;
              const link =
                row.share.name ??
                `${row.share.type === "REVERSE" ? "/r/" : "/s/"}${row.share.token}`;

              // The same sentence the links page uses: what happened, naming
              // its subject, with the particulars on the line below.
              const what = alarm
                ? `${label} on ${link}`
                : row.file
                  ? `${label} ${row.file.originalName}`
                  : row.action === "DOWNLOAD"
                    ? `Downloaded everything from ${link} as a ZIP`
                    : `${label} ${link}`;

              const detail = [
                row.ipAddress ?? "address not recorded",
                describeUserAgent(row.userAgent),
                row.file && !alarm ? link : null,
                row.bytesServed > 0n
                  ? formatBytes(Number(row.bytesServed))
                  : null,
              ].filter(Boolean);

              return (
                <li
                  key={row.id}
                  className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-4 border-b border-line py-3 last:border-b-0"
                >
                  <time
                    dateTime={row.createdAt.toISOString()}
                    title={row.createdAt.toISOString()}
                    className="data pt-0.5 text-fg-subtle"
                  >
                    {timeAgo(row.createdAt.toISOString())}
                  </time>

                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p
                      className={
                        alarm
                          ? "break-words text-sm font-medium text-warn"
                          : "break-words text-sm font-medium text-fg"
                      }
                    >
                      {what}
                      {row.uploaderName && (
                        <span
                          className="font-normal text-fg-subtle"
                          title="As the sender typed it — not a verified identity"
                        >
                          {" "}
                          · from “{row.uploaderName}”
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
          </ul>
        )}

        {pageCount > 1 && (
          <nav
            aria-label="Pages"
            className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px] text-fg-subtle"
          >
            {filters.page > 1 ? (
              <Button asChild variant="quiet" size="sm">
                <Link href={pageHref(filters.page - 1)}>Newer</Link>
              </Button>
            ) : (
              <span />
            )}
            <span className="tabular-nums">
              Page {filters.page} of {pageCount}
            </span>
            {filters.page < pageCount ? (
              <Button asChild variant="quiet" size="sm">
                <Link href={pageHref(filters.page + 1)}>Older</Link>
              </Button>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Panel>
    </div>
  );
}
