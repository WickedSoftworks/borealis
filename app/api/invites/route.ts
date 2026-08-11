import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  canMintRole,
  generateInviteCode,
  hashInviteCode,
  isAdmin,
  ROLE_ADMIN,
  ROLE_USER,
} from "@/lib/invites";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const schema = z.object({
  grantsRole: z.enum([ROLE_USER, ROLE_ADMIN]).default(ROLE_USER),
  note: z.string().max(200).optional(),
  expiresInDays: z.number().int().positive().max(365).nullable().default(7),
});

export async function POST(req: Request) {
  const session = await getSession();

  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Admins may invite users; only root may mint another admin. An admin
  // creating a peer admin would be control over another admin, which this
  // instance's trust model deliberately withholds.
  if (!canMintRole(session.user.role, parsed.data.grantsRole)) {
    return NextResponse.json(
      { error: "Only root can create admin invitations." },
      { status: 403 },
    );
  }

  const code = generateInviteCode();

  const invite = await db.invite.create({
    data: {
      codeHash: hashInviteCode(code),
      grantsRole: parsed.data.grantsRole,
      note: parsed.data.note,
      expiresAt: parsed.data.expiresInDays
        ? new Date(Date.now() + parsed.data.expiresInDays * 86400000)
        : null,
      createdById: session.user.id,
    },
    select: { id: true, grantsRole: true, expiresAt: true },
  });

  // The only time the plaintext exists outside the creator's screen.
  return NextResponse.json({ ...invite, code }, { status: 201 });
}

export async function GET() {
  const session = await getSession();

  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invites = await db.invite.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      grantsRole: true,
      note: true,
      expiresAt: true,
      revokedAt: true,
      redeemedAt: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
      redeemedBy: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json({ invites });
}
