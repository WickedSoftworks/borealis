import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { trashFolderTree } from "@/lib/folders";
import { purgeDueAt } from "@/lib/purge";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Trash a folder and everything inside it.
 *
 * Owner-only, and always a soft delete — unlike a file, a folder has no
 * admin-moderation path, because there is nothing in a folder that an admin
 * could not reach through the files themselves.
 *
 * The counts come back so the interface can say what actually happened. "Moved
 * 1 folder and 240 files to the trash" is the difference between a confident
 * undo and a panic.
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

  const folder = await db.folder.findFirst({
    where: { id, ownerId: session.user.id, deletedAt: null },
    select: { name: true },
  });

  const result = await trashFolderTree(id, session.user.id);

  if (!folder || result === null) {
    // Unknown, someone else's, or already trashed — one answer for all three,
    // so this cannot be used to probe for folders.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    trashed: folder.name,
    folders: result.folders,
    files: result.files,
    revokedShares: result.revokedShares,
    purgeAt: purgeDueAt(result.deletedAt).toISOString(),
  });
}
