import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { folderNameSchema } from "@/lib/folder-name";
import {
  assertOwnedFolder,
  folderRows,
  siblingNameTaken,
  wouldCycle,
} from "@/lib/folders";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Rename and/or reparent a folder.
 *
 * Both in one handler because the interface offers them together — dragging a
 * folder onto another is a reparent, the dialog can do either — and because the
 * sibling-name check depends on the destination in both cases.
 */
const patchSchema = z
  .object({
    name: folderNameSchema.optional(),
    // Present-and-null means "move to the root", which is a different request
    // from absent, meaning "leave it where it is".
    parentId: z.string().nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.parentId !== undefined, {
    message: "Nothing to change",
  });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const folder = await db.folder.findFirst({
    where: { id, ownerId: session.user.id, deletedAt: null },
    select: { id: true, name: true, parentId: true },
  });

  if (!folder) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { name, parentId } = parsed.data;
  const nextParentId = parentId === undefined ? folder.parentId : parentId;

  if (parentId !== undefined && parentId !== null) {
    if ((await assertOwnedFolder(parentId, session.user.id)) === null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  if (nextParentId !== folder.parentId) {
    // Moving a folder into its own descendant detaches the whole subtree: it
    // keeps existing, keeps belonging to this account, and becomes unreachable
    // from every screen. The depth cap is enforced by the same call.
    if (
      wouldCycle(await folderRows(session.user.id), folder.id, nextParentId)
    ) {
      return NextResponse.json(
        { error: "A folder cannot be moved inside itself." },
        { status: 409 },
      );
    }
  }

  const nextName = name ?? folder.name;

  if (
    await siblingNameTaken(session.user.id, nextParentId, nextName, folder.id)
  ) {
    return NextResponse.json(
      { error: `There is already a folder called "${nextName}" there.` },
      { status: 409 },
    );
  }

  // Scoped to the owner in the write itself, not only in the read above, so
  // there is no window for the row to change hands in between.
  const updated = await db.folder.updateMany({
    where: { id: folder.id, ownerId: session.user.id, deletedAt: null },
    data: { name: nextName, parentId: nextParentId },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    id: folder.id,
    name: nextName,
    parentId: nextParentId,
  });
}
