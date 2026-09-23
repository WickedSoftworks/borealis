import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { discardJob, retryJob } from "@/lib/jobs";

export const runtime = "nodejs";

const schema = z.object({ action: z.enum(["retry", "discard"]) });

/**
 * Act on a FAILED job: give it a fresh set of attempts, or drop it.
 *
 * A job reaches FAILED after its retries are spent and then sits there — the
 * worker never looks at it again. Before this, the only way to learn one
 * existed was a line in stdout.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { session, denied } = await requireAdmin();
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const job = await db.job.findUnique({
    where: { id },
    select: { type: true, lastError: true },
  });

  const done =
    parsed.data.action === "retry" ? await retryJob(id) : await discardJob(id);

  if (!done || !job) {
    return NextResponse.json(
      { error: "That job is not in the failed state any more." },
      { status: 409 },
    );
  }

  await recordAudit({
    action: parsed.data.action === "retry" ? "JOB_RETRY" : "JOB_DISCARD",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "job",
    targetId: id,
    targetLabel: job.type,
    detail: { lastError: job.lastError },
    request: req,
  });

  return NextResponse.json({ ok: true });
}
