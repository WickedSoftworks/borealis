import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canDeleteFile } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Permanently delete a file: the stored bytes, the row, and any share that
 * carried it.
 *
 * Deliberately not a soft delete. The bytes go immediately, so leaving a
 * tombstone row would only imply a recoverability that does not exist. Access
 * log entries survive with a null fileId (onDelete: SetNull), because the
 * record of who fetched what must outlive the file itself.
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

  const file = await db.file.findUnique({
    where: { id },
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      ownerId: true,
      owner: { select: { id: true, role: true } },
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

  // Shares first: a live link pointing at bytes that no longer exist would
  // serve a 500 rather than an honest "this is gone".
  const shareIds = (
    await db.shareItem.findMany({
      where: { fileId: id },
      select: { shareId: true },
    })
  ).map((item) => item.shareId);

  if (shareIds.length > 0) {
    await db.share.updateMany({
      where: { id: { in: shareIds }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // Storage may already be missing the object; that is not a reason to keep
  // the row, so the failure is logged and the delete proceeds.
  try {
    await storage.delete(file.storageKey);
  } catch (error) {
    console.warn(`Could not remove ${file.storageKey} from storage:`, error);
  }

  await db.file.delete({ where: { id } });

  return NextResponse.json({
    ok: true,
    deleted: file.originalName,
    revokedShares: shareIds.length,
  });
}
