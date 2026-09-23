import { ACCESS_ACTIONS, type AccessAction } from "@/lib/constants";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * The access log, filtered.
 *
 * The audit trail is a headline feature and the dashboard shows twelve rows of
 * it. This is the full view's query — shared by the page and the CSV export,
 * so what an owner filters on screen is exactly what they download.
 *
 * Always scoped to the caller's own links in the `where` itself.
 */

export type ActivityFilters = {
  shareId: string | null;
  action: AccessAction | null;
  from: Date | null;
  to: Date | null;
  page: number;
};

export const ACTIVITY_PAGE_SIZE = 50;
export const EXPORT_CAP = 100_000;

function day(raw: string | null | undefined, end: boolean): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseActivityFilters(
  get: (name: string) => string | null | undefined,
): ActivityFilters {
  const action = get("action");
  const page = Number(get("page"));

  return {
    shareId: get("share") || null,
    action: ACCESS_ACTIONS.includes(action as AccessAction)
      ? (action as AccessAction)
      : null,
    from: day(get("from"), false),
    to: day(get("to"), true),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export function activityWhere(
  ownerId: string,
  filters: ActivityFilters,
): Prisma.ShareAccessWhereInput {
  return {
    share: { ownerId },
    ...(filters.shareId ? { shareId: filters.shareId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };
}

/**
 * One CSV field. Quoted when it must be, with quotes doubled — and a leading
 * `=`, `+`, `-`, or `@` prefixed with an apostrophe, because a filename like
 * `=HYPERLINK(...)` is a formula to every spreadsheet that opens the export,
 * and filenames here are chosen by whoever uploaded the file.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";

  let text = String(value);

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(
  values: Array<string | number | null | undefined>,
): string {
  return `${values.map(csvField).join(",")}\r\n`;
}
