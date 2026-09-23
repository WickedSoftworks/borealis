import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { parseByteSize } from "@/lib/bytes";
import { db } from "@/lib/db";
import {
  isAdmin,
  isRoot,
  ROLE_ADMIN,
  ROLE_ROOT,
  ROLE_USER,
} from "@/lib/invites";
import { log } from "@/lib/log";
import { getSession } from "@/lib/session";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ban"),
    reason: z.string().max(200).optional(),
  }),
  z.object({ action: z.literal("unban") }),
  z.object({
    action: z.literal("set-role"),
    role: z.enum([ROLE_USER, ROLE_ADMIN]),
  }),
  z.object({
    action: z.literal("set-quota"),
    /** "50GB", "unlimited"… or null to fall back to the instance default. */
    quota: z.string().max(40).nullable(),
  }),
  z.object({
    action: z.literal("delete"),
    /** Typed by the operator, so a misclick cannot remove an account. */
    confirmEmail: z.string(),
  }),
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true, email: true, storageQuotaBytes: true },
  });

  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Root is untouchable through the web. It is managed from the console only,
  // which is the point of it having no credential by default.
  if (target.role === ROLE_ROOT) {
    return NextResponse.json(
      { error: "The root account is managed from the console." },
      { status: 403 },
    );
  }

  if (target.id === session.user.id) {
    return NextResponse.json(
      { error: "You can't do that to your own account." },
      { status: 403 },
    );
  }

  // Admins are peers: only root may ban, promote, demote, cap, or delete one.
  if (target.role === ROLE_ADMIN && !isRoot(session.user.role)) {
    return NextResponse.json(
      { error: "Only root can act on another admin." },
      { status: 403 },
    );
  }

  // Likewise, only root can create an admin.
  if (parsed.data.action === "set-role" && !isRoot(session.user.role)) {
    return NextResponse.json(
      { error: "Only root can change roles." },
      { status: 403 },
    );
  }

  const actor = { id: session.user.id, email: session.user.email };
  const audit = {
    actor,
    targetType: "user" as const,
    targetId: target.id,
    targetLabel: target.email,
    request: req,
  };

  switch (parsed.data.action) {
    case "ban":
      await db.user.update({
        where: { id },
        data: { banned: true, banReason: parsed.data.reason ?? null },
      });
      // Sessions are revoked too, or a ban would not take effect until the
      // existing cookie happened to expire.
      await db.session.deleteMany({ where: { userId: id } });
      await recordAudit({
        ...audit,
        action: "USER_BAN",
        detail: { reason: parsed.data.reason ?? null },
      });
      break;

    case "unban":
      await db.user.update({
        where: { id },
        data: { banned: false, banReason: null, banExpires: null },
      });
      await recordAudit({ ...audit, action: "USER_UNBAN" });
      break;

    case "set-role":
      await db.user.update({ where: { id }, data: { role: parsed.data.role } });
      await recordAudit({
        ...audit,
        action: "USER_ROLE",
        detail: { from: target.role ?? ROLE_USER, to: parsed.data.role },
      });
      break;

    case "set-quota": {
      const raw = parsed.data.quota;
      const quota = raw === null ? null : parseByteSize(raw);

      // "unlimited" parses to null too, but means something different from
      // "use the default": store a ceiling nobody will reach.
      const unlimited = raw !== null && /^\s*unlimited\s*$/i.test(raw);

      if (raw !== null && quota === null && !unlimited) {
        return NextResponse.json(
          { error: `"${raw}" is not a size. Try "50GB" or "unlimited".` },
          { status: 400 },
        );
      }

      const stored = unlimited ? 2n ** 62n : quota;

      await db.user.update({
        where: { id },
        data: { storageQuotaBytes: stored },
      });
      await recordAudit({
        ...audit,
        action: "USER_QUOTA",
        detail: {
          from: target.storageQuotaBytes?.toString() ?? "default",
          to: stored?.toString() ?? "default",
        },
      });
      break;
    }

    case "delete": {
      if (
        parsed.data.confirmEmail.trim().toLowerCase() !==
        target.email.toLowerCase()
      ) {
        return NextResponse.json(
          { error: "Type the account's email exactly to confirm." },
          { status: 400 },
        );
      }

      // Keys first: the cascade takes the File rows, and with them the only
      // record of where the bytes live.
      const files = await db.file.findMany({
        where: { ownerId: id },
        select: { storageKey: true, thumbnailKey: true, size: true },
      });

      await db.user.delete({ where: { id } });

      let orphaned = 0;

      for (const file of files) {
        for (const key of [file.storageKey, file.thumbnailKey]) {
          if (!key) continue;
          await storage.delete(key).catch(() => {
            orphaned++;
          });
        }
      }

      if (orphaned > 0) {
        log.warn("account.delete_orphaned", { userId: id, orphaned });
      }

      await recordAudit({
        ...audit,
        action: "USER_DELETE",
        detail: {
          files: files.length,
          bytes: files
            .reduce((total, file) => total + file.size, 0n)
            .toString(),
        },
      });
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
