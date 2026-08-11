import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  isAdmin,
  isRoot,
  ROLE_ADMIN,
  ROLE_ROOT,
  ROLE_USER,
} from "@/lib/invites";
import { getSession } from "@/lib/session";

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
    select: { id: true, role: true, email: true },
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

  // Admins are peers: only root may ban, promote, or demote one.
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

  switch (parsed.data.action) {
    case "ban":
      await db.user.update({
        where: { id },
        data: { banned: true, banReason: parsed.data.reason ?? null },
      });
      // Sessions are revoked too, or a ban would not take effect until the
      // existing cookie happened to expire.
      await db.session.deleteMany({ where: { userId: id } });
      break;

    case "unban":
      await db.user.update({
        where: { id },
        data: { banned: false, banReason: null, banExpires: null },
      });
      break;

    case "set-role":
      await db.user.update({ where: { id }, data: { role: parsed.data.role } });
      break;
  }

  return NextResponse.json({ ok: true });
}
