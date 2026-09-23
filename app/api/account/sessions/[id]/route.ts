import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * End one of your own sessions — a browser you signed in on and no longer
 * have, or one you do not recognise.
 *
 * By session id rather than through better-auth's `revokeSession`, which
 * takes the session TOKEN: the account page would otherwise have to ship
 * every live token to the browser just so it could name one to kill.
 * Scoped to the caller in the delete itself.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (id === session.session.id) {
    return NextResponse.json(
      { error: "That is this session. Sign out instead." },
      { status: 400 },
    );
  }

  const result = await db.session.deleteMany({
    where: { id, userId: session.user.id },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
