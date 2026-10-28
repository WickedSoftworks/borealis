import { NextResponse } from "next/server";
import { unlinkForUser } from "@/lib/discord/link";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/** Disconnect one of your Discord accounts. Scoped to the caller. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await unlinkForUser(session.user.id, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
