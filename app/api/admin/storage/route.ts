import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { recordAudit } from "@/lib/audit";
import { reconcileStorage } from "@/lib/reconcile";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({ remove: z.boolean().default(false) });

/**
 * Run storage reconciliation now: report objects no file row points at, or —
 * with `remove` — delete them.
 *
 * Deleting is an operator's explicit decision here, never the sweep's default
 * (see lib/reconcile.ts for the restored-backup case that makes that matter),
 * so it is recorded like any other destructive admin action.
 */
export async function POST(req: Request) {
  const { session, denied } = await requireAdmin();
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const report = await reconcileStorage({ remove: parsed.data.remove });

  if (parsed.data.remove && report.deleted > 0) {
    await recordAudit({
      action: "SETTING_CHANGE",
      actor: { id: session.user.id, email: session.user.email },
      targetType: "instance",
      targetLabel: "removed orphaned storage objects",
      detail: {
        deleted: report.deleted,
        bytes: report.orphanBytes,
        failed: report.failed,
      },
      request: req,
    });
  }

  return NextResponse.json({ ok: true, report });
}
