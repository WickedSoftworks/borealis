import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/** End every session on this account except the one making the request. */
export async function DELETE() {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db.session.deleteMany({
    where: { userId: session.user.id, id: { not: session.session.id } },
  });

  return NextResponse.json({ ok: true, revoked: result.count });
}
