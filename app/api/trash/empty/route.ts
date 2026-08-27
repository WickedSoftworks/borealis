import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { emptyTrash } from "@/lib/trash";

export const runtime = "nodejs";

/**
 * Empty your own trash now, without waiting out the retention window.
 *
 * Scoped to the caller's own files at the query, so there is no id to tamper
 * with and no way to empty anyone else's trash — including for an admin, who
 * has no business reaching into an account's undo history when the delete
 * endpoint already removes another user's file outright.
 *
 * Purged inline rather than queued: "empty the trash" is a promise about now,
 * and enqueueing would leave the files listed in the panel for up to a poll
 * interval after the operator was told they were gone. Files whose bytes could
 * not be reached are counted separately and left trashed for the sweep to
 * retry, rather than reported as removed.
 */
export async function POST() {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { purged, failed } = await emptyTrash(session.user.id);

  return NextResponse.json({ ok: true, purged, failed });
}
