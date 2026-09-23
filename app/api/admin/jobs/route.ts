import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** Retry every failed job at once — after fixing whatever made them fail. */
export async function POST(req: Request) {
  const { session, denied } = await requireAdmin();
  if (denied) return denied;

  const result = await db.job.updateMany({
    where: { status: "FAILED" },
    data: { status: "PENDING", attempts: 0, runAt: new Date() },
  });

  if (result.count > 0) {
    await recordAudit({
      action: "JOB_RETRY",
      actor: { id: session.user.id, email: session.user.email },
      targetType: "job",
      targetLabel: `${result.count} failed jobs`,
      request: req,
    });
  }

  return NextResponse.json({ ok: true, retried: result.count });
}
