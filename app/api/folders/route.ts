import { NextResponse } from "next/server";
import { z } from "zod";
import { folderNameSchema } from "@/lib/folder-name";
import {
  assertOwnedFolder,
  buildTree,
  depthOf,
  folderRows,
  MAX_FOLDER_DEPTH,
  siblingNameTaken,
  withFolderLock,
} from "@/lib/folders";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const createSchema = z.object({
  name: folderNameSchema,
  parentId: z.string().nullable().default(null),
});

export async function GET() {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    folders: buildTree(await folderRows(session.user.id)),
  });
}

export async function POST(req: Request) {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));

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
    // A parent that is unknown, trashed, or someone else's is refused rather
    // than quietly creating the folder at the root: the caller named a place,
    // and not getting it is something they need to be told.
    if (parentId !== null) {
      if ((await assertOwnedFolder(parentId, ownerId, tx)) === null) {
        return { status: 404, body: { error: "Not found" } };
      }

      const rows = await folderRows(ownerId, {}, tx);

      if (depthOf(rows, parentId) >= MAX_FOLDER_DEPTH) {
        return {
          status: 409,
          body: {
            error: `Folders cannot nest deeper than ${MAX_FOLDER_DEPTH}.`,
          },
        };
      }
    }

    if (await siblingNameTaken(ownerId, parentId, name, undefined, tx)) {
      return {
        status: 409,
        body: { error: `There is already a folder called "${name}" here.` },
      };
    }

    const folder = await tx.folder.create({
      data: { name, parentId, ownerId },
      select: { id: true, name: true, parentId: true },
    });

    return { status: 201, body: folder };
  });

  return NextResponse.json(result.body, { status: result.status });
}
