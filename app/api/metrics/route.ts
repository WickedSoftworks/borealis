import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { jobCounts } from "@/lib/jobs";
import { instanceUsage } from "@/lib/quota";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prometheus metrics, for an operator who already runs monitoring.
 *
 * Off unless `METRICS_TOKEN` is set, and then only for a request that presents
 * it as a bearer token. `/api/health` stays the unauthenticated liveness probe
 * and says nothing identifying; the numbers here — how much is stored, how
 * many accounts, how many jobs are failing — are exactly what a stranger
 * probing the box should not learn.
 */
function authorised(req: Request): boolean {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return false;

  const presented =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

function metric(
  name: string,
  help: string,
  type: "gauge" | "counter",
  value: number | bigint,
): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return new Response("Not found", { status: 404 });
  }

  const [stored, trash, files, users, liveShares, jobs, settings] =
    await Promise.all([
      instanceUsage(),
      db.file.aggregate({
        where: { deletedAt: { not: null } },
        _sum: { size: true },
      }),
      db.file.count({ where: { deletedAt: null } }),
      db.user.count(),
      db.share.count({ where: { revokedAt: null } }),
      jobCounts(),
      getSettings(),
    ]);

  const body = [
    metric(
      "borealis_stored_bytes",
      "Bytes stored, trash included.",
      "gauge",
      stored,
    ),
    metric(
      "borealis_trash_bytes",
      "Bytes held in the trash awaiting purge.",
      "gauge",
      trash._sum.size ?? 0n,
    ),
    metric("borealis_files", "Live files.", "gauge", files),
    metric("borealis_accounts", "Accounts, root included.", "gauge", users),
    metric("borealis_live_links", "Links not revoked.", "gauge", liveShares),
    metric(
      "borealis_jobs_pending",
      "Jobs waiting to run.",
      "gauge",
      jobs.PENDING,
    ),
    metric("borealis_jobs_running", "Jobs running now.", "gauge", jobs.RUNNING),
    metric(
      "borealis_jobs_failed",
      "Jobs that exhausted their retries and need an operator.",
      "gauge",
      jobs.FAILED,
    ),
    ...(settings.storageCeilingBytes !== null
      ? [
          metric(
            "borealis_storage_ceiling_bytes",
            "The configured instance-wide storage ceiling.",
            "gauge",
            settings.storageCeilingBytes,
          ),
        ]
      : []),
  ].join("");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; version=0.0.4",
      "Cache-Control": "no-store",
    },
  });
}
