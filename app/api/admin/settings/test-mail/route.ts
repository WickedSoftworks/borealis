import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { recordAudit } from "@/lib/audit";
import { sendTestMail } from "@/lib/email";
import { hit, RULES, tooManyRequests } from "@/lib/rate-limit";

export const runtime = "nodejs";

const schema = z.object({ to: z.email() });

/**
 * Send a test message with the mail settings in effect right now, and report
 * exactly what the server said. The button operators will thank you for: a
 * broken relay otherwise surfaces as a password reset that never arrives.
 */
export async function POST(req: Request) {
  const { session, denied } = await requireAdmin();
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Enter an address." }, { status: 400 });
  }

  const limit = await hit(`mail-test:${session.user.id}`, RULES.mailTest);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const result = await sendTestMail(parsed.data.to);

  await recordAudit({
    action: "MAIL_TEST",
    actor: { id: session.user.id, email: session.user.email },
    targetType: "instance",
    targetLabel: parsed.data.to,
    detail: result.ok ? { response: result.response } : { error: result.error },
    request: req,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
