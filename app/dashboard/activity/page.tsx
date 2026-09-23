import Link from "next/link";
import { ACTION_LABEL, ALARM_ACTIONS, timeAgo } from "@/components/access-log";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconDownload, IconLock } from "@/components/world/icons";
import { Panel, StateTag } from "@/components/world/panel";
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
  "h-9 w-full border border-dotted border-ink-40 bg-ground px-2 font-mono text-[0.8125rem] text-ink-90 outline-none focus-visible:border-solid focus-visible:border-ink-100";

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
        <h1 className="text-[0.9375rem] text-ink-90">Activity</h1>
        <p className="text-[0.6875rem] text-ink-60">
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
          <label className="flex flex-col gap-1.5 text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
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

          <label className="flex flex-col gap-1.5 text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
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

          <div className="flex flex-col gap-1.5 text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
            <label htmlFor="activity-from">From</label>
            <Input
              id="activity-from"
              type="date"
              name="from"
              defaultValue={get("from") ?? ""}
            />
          </div>

          <div className="flex flex-col gap-1.5 text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
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
          <p className="px-1 py-6 text-center text-[0.75rem] text-ink-60">
            Nothing matches. Every download, preview, upload, wrong password,
            and refused address on your links is recorded here.
          </p>
        ) : (
          <ul className="font-mono">
            {rows.map((row) => {
              const alarm = ALARM_ACTIONS.has(row.action);
              const link =
                row.share.name ??
                `${row.share.type === "REVERSE" ? "/r/" : "/s/"}${row.share.token}`;

              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-dotted border-ink-20 py-2 last:border-b-0"
                >
                  <time
                    dateTime={row.createdAt.toISOString()}
                    title={row.createdAt.toISOString()}
                    className="w-16 shrink-0 text-[0.6875rem] tabular-nums text-ink-60"
                  >
                    {timeAgo(row.createdAt.toISOString())}
                  </time>

                  <span className="shrink-0">
                    <StateTag tone={alarm ? "alarm" : "quiet"}>
                      {alarm ? (
                        <IconLock className="mr-1 inline size-3 align-[-2px]" />
                      ) : (
                        <IconDownload className="mr-1 inline size-3 align-[-2px]" />
                      )}
                      {ACTION_LABEL[row.action] ?? row.action}
                    </StateTag>
                  </span>

                  <span className="min-w-0 basis-full truncate text-[0.8125rem] text-ink-80 sm:basis-auto sm:flex-1">
                    {row.file?.originalName ??
                      (row.action === "DOWNLOAD"
                        ? "Every file, as a ZIP"
                        : "—")}
                    <span className="text-ink-60"> · {link}</span>
                  </span>

                  <span className="shrink-0 text-[0.6875rem] tabular-nums text-ink-60">
                    {row.ipAddress ?? "address not recorded"} ·{" "}
                    {describeUserAgent(row.userAgent)}
                  </span>

                  {row.bytesServed > 0n && (
                    <span className="shrink-0 text-[0.6875rem] tabular-nums text-ink-60">
                      {formatBytes(Number(row.bytesServed))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {pageCount > 1 && (
          <nav
            aria-label="Pages"
            className="mt-3 flex items-center justify-between gap-3 border-t border-dotted border-ink-20 pt-3 text-[0.6875rem] text-ink-60"
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
