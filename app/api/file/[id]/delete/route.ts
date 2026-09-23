import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { canDeleteFile } from "@/lib/permissions";
import { purgeDueAt } from "@/lib/purge";
import { getSession } from "@/lib/session";
import { purgeFile, revokeSharesCarrying, trashFile } from "@/lib/trash";

export const runtime = "nodejs";

/**
 * Delete a file — into the trash if it is yours, permanently if it is not.
 *
 * Your own file is soft-deleted: the row keeps a `deletedAt`, the bytes survive
 * a retention window (lib/purge.ts), and a PURGE_FILE job removes them when it
 * closes. That window exists for one reason, which is that "delete" is one
 * mis-click away from every other action in a file table.
 *
 * Someone else's file is removed outright. Reaching another account's file
 * requires admin or root, and an admin acting on a user's file is moderation or
 * disk pressure — a moderation action its target can undo from their own trash
 * is not a moderation action. Which of the two happened is reported back in
 * `trashed`, because the interface must not offer an "undo" that does not exist.
 *
 * Both paths revoke every share carrying the file first: a link pointing into
 * the trash would either 404 mid-download or spring back to life on restore.
 * `ShareAccess` rows survive either way with a null `fileId` — the record of who
 * fetched what outlives the file.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const file = await db.file.findUnique({
    where: { id },
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      thumbnailKey: true,
      size: true,
      ownerId: true,
      deletedAt: true,
      owner: { select: { id: true, role: true, email: true } },
    },
  });

  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!canDeleteFile(session.user, file.owner)) {
    // 404 rather than 403 for files the actor may not even know exist —
    // an admin probing for another admin's file learns nothing either way.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const revokedShares = await revokeSharesCarrying(id);
  const isOwn = file.ownerId === session.user.id;

  if (!isOwn) {
    // Storage failures are logged and the row goes anyway. Refusing to remove a
    // file because its object store hiccuped leaves an admin unable to act, and
    // orphaned bytes are the lesser problem of the two.
    await purgeFile(file, { orphanOnStorageFailure: true });

    // Removing someone else's file is the one delete that cannot be undone
    // and was not the owner's own decision, so it is the one that is recorded.
    await recordAudit({
      action: "FILE_DELETE_OTHER",
      actor: { id: session.user.id, email: session.user.email },
      targetType: "file",
      targetId: file.id,
      targetLabel: file.originalName,
      detail: {
        ownerId: file.ownerId,
        ownerEmail: file.owner.email,
        size: file.size.toString(),
        revokedShares,
      },
      request: req,
    });

    return NextResponse.json({
      ok: true,
      trashed: false,
      deleted: file.originalName,
      revokedShares,
    });
  }

  const trashedAt = (await trashFile(id)) ?? file.deletedAt ?? new Date();

  return NextResponse.json({
    ok: true,
    trashed: true,
    deleted: file.originalName,
    revokedShares,
    purgeAt: purgeDueAt(trashedAt).toISOString(),
  });
}
