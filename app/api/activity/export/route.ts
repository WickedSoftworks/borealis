import {
  activityWhere,
  csvRow,
  EXPORT_CAP,
  parseActivityFilters,
} from "@/lib/activity";
import { db } from "@/lib/db";
import { contentDisposition } from "@/lib/http";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const BATCH = 1000;

/**
 * The access log as CSV, with the same filters as the page.
 *
 * Streamed a thousand rows at a time, keyset-paged on (createdAt, id), so an
 * export of a busy year costs one batch of memory. Capped, and the last line
 * says so when the cap is hit, rather than ending as if that were everything.
 */
export async function GET(req: Request) {
  const session = await getSession();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const filters = parseActivityFilters((name) => url.searchParams.get(name));
  const where = activityWhere(session.user.id, filters);

  const encoder = new TextEncoder();
  let cursor: { id: string } | undefined;
  let written = 0;
  let headerSent = false;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(
          encoder.encode(
            csvRow([
              "time",
              "action",
              "link",
              "link_url",
              "file",
              "ip_address",
              "user_agent",
              "bytes",
            ]),
          ),
        );
        return;
      }

      if (written >= EXPORT_CAP) {
        controller.enqueue(
          encoder.encode(
            csvRow([
              `# stopped at ${EXPORT_CAP} rows; narrow the dates to export the rest`,
            ]),
          ),
        );
        controller.close();
        return;
      }

      const rows = await db.shareAccess.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: Math.min(BATCH, EXPORT_CAP - written),
        ...(cursor ? { cursor, skip: 1 } : {}),
        select: {
          id: true,
          createdAt: true,
          action: true,
          ipAddress: true,
          userAgent: true,
          bytesServed: true,
          share: { select: { name: true, token: true, type: true } },
          file: { select: { originalName: true } },
        },
      });

      if (rows.length === 0) {
        controller.close();
        return;
      }

      cursor = { id: rows[rows.length - 1].id };
      written += rows.length;

      controller.enqueue(
        encoder.encode(
          rows
            .map((row) =>
              csvRow([
                row.createdAt.toISOString(),
                row.action,
                row.share.name,
                `${row.share.type === "REVERSE" ? "/r/" : "/s/"}${row.share.token}`,
                row.file?.originalName ??
                  (row.action === "DOWNLOAD" ? "(all files, as a ZIP)" : null),
                row.ipAddress,
                row.userAgent,
                row.bytesServed.toString(),
              ]),
            )
            .join(""),
        ),
      );
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(`access-log-${stamp}.csv`),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
