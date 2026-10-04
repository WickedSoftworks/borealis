import { NextResponse } from "next/server";
import { z } from "zod";
import { folderNameSchema } from "@/lib/folder-name";
import {
  assertOwnedFolder,
  depthOf,
  folderRows,
  heightOf,
  MAX_FOLDER_DEPTH,
  siblingNameTaken,
  withFolderLock,
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

  const { name, parentId } = parsed.data;
  const ownerId = session.user.id;

  // Checked and written as one change to the tree; see withFolderLock.
  const result = await withFolderLock(ownerId, async (tx) => {
    const folder = await tx.folder.findFirst({
      where: { id, ownerId, deletedAt: null },
      select: { id: true, name: true, parentId: true },
    });

    if (!folder) return { status: 404, body: { error: "Not found" } };

    const nextParentId = parentId === undefined ? folder.parentId : parentId;

    if (parentId !== undefined && parentId !== null) {
      if ((await assertOwnedFolder(parentId, ownerId, tx)) === null) {
        return { status: 404, body: { error: "Not found" } };
      }
    }

    if (nextParentId !== folder.parentId) {
      const rows = await folderRows(ownerId, {}, tx);

      if (wouldCycle(rows, folder.id, nextParentId)) {
        return {
          status: 409,
          body: { error: "A folder cannot be moved inside itself." },
        };
      }

      // The whole subtree moves, so it is the subtree that must still fit.
      const depth =
        (nextParentId === null ? 0 : depthOf(rows, nextParentId)) +
        heightOf(rows, folder.id);

      if (depth > MAX_FOLDER_DEPTH) {
        return {
          status: 409,
          body: {
            error: `Folders cannot nest deeper than ${MAX_FOLDER_DEPTH}.`,
          },
        };
      }
    }

    const nextName = name ?? folder.name;

    if (
      await siblingNameTaken(ownerId, nextParentId, nextName, folder.id, tx)
    ) {
      return {
        status: 409,
        body: {
          error: `There is already a folder called "${nextName}" there.`,
        },
      };
    }

    await tx.folder.update({
      where: { id: folder.id },
      data: { name: nextName, parentId: nextParentId },
    });

    return {
      status: 200,
      body: { ok: true, id: folder.id, name: nextName, parentId: nextParentId },
    };
  });

  return NextResponse.json(result.body, { status: result.status });
}
