import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { restoreFile } from "@/lib/trash";

export const runtime = "nodejs";

/**
 * Take a file back out of the trash.
 *
 * Owner-only, and deliberately not governed by `canDeleteFile`. That function
 * answers "may this actor destroy this file", which an admin may for an
 * ordinary user — but an admin's delete never produces a trashed row in the
 * first place (see the delete route), so there is nothing here for a
 * non-owner to reach. Scoping the write to `ownerId` keeps it that way even if
 * that ever changes.
 *
 * Restoring returns the file. It does not un-revoke the links that carried it:
 * those were handed to other people and quietly reviving one nobody re-checked
 * is the opposite of what this product promises. Share the file again.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read for the message only; the write below is what actually authorises.
  const file = await db.file.findFirst({
    where: { id, ownerId: session.user.id, deletedAt: { not: null } },
    select: { originalName: true },
  });

  const restored = await restoreFile(id, session.user.id);

  if (!restored) {
    // Missing, someone else's, never trashed, or already purged — all the same
    // 404, so this cannot be used to probe for files.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    restored: file?.originalName ?? "the file",
  });
}
