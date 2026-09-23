import type { AuditAction, AuditTarget } from "@/lib/constants";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { clientIp } from "@/lib/request";

/**
 * The operator audit trail.
 *
 * `ShareAccess` answers "who fetched what through my link". Nothing answered
 * "who banned this account, promoted that one, or deleted my file" — the admin
 * routes performed all three silently. This is that record.
 *
 * Written for actions taken on something the actor does not own: another
 * account, another account's file, the instance itself. An owner deleting
 * their own file is not an audit event; an admin deleting someone else's is.
 *
 * A failed write is logged and swallowed. The action it describes has already
 * happened by the time this runs, and failing the request afterwards would
 * tell the operator it did not.
 */

export type AuditActor = { id: string; email?: string | null };

export type AuditInput = {
  action: AuditAction;
  actor: AuditActor | null;
  targetType: AuditTarget;
  targetId?: string | null;
  targetLabel?: string | null;
  detail?: Record<string, unknown>;
  request?: Request | Headers | null;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        action: input.action,
        actorId: input.actor?.id ?? null,
        actorEmail: input.actor?.email ?? null,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        targetLabel: input.targetLabel ?? null,
        detail: input.detail ? JSON.stringify(input.detail) : null,
        ipAddress: input.request ? clientIp(input.request) : null,
      },
    });
  } catch (error) {
    log.warn("audit.write_failed", { action: input.action, error });
  }
}
