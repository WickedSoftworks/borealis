import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin, isRoot } from "@/lib/invites";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/** Revoke an unredeemed invitation. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invite = await db.invite.findUnique({
    where: { id },
    select: { createdById: true, grantsRole: true },
  });

  if (!invite) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // An admin can revoke their own invitations; root can revoke anyone's.
  // Otherwise one admin could undo another's, which is control over a peer.
  const mayRevoke =
    isRoot(session.user.role) || invite.createdById === session.user.id;

  if (!mayRevoke) {
    return NextResponse.json(
      { error: "You can only revoke invitations you created." },
      { status: 403 },
    );
  }

  const result = await db.invite.updateMany({
    where: { id, redeemedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) {
    return NextResponse.json(
      { error: "That invitation was already used or revoked." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
