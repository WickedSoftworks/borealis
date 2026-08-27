import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { folderNameSchema } from "@/lib/folder-name";
import {
  assertOwnedFolder,
  buildTree,
  depthOf,
  folderRows,
  MAX_FOLDER_DEPTH,
  siblingNameTaken,
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

  // A parent that is unknown, trashed, or someone else's is refused rather than
  // quietly creating the folder at the root: the caller named a place, and not
  // getting it is something they need to be told.
  if (parentId !== null) {
    if ((await assertOwnedFolder(parentId, session.user.id)) === null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await folderRows(session.user.id);

    if (depthOf(rows, parentId) >= MAX_FOLDER_DEPTH) {
      return NextResponse.json(
        { error: `Folders cannot nest deeper than ${MAX_FOLDER_DEPTH}.` },
        { status: 409 },
      );
    }
  }

  if (await siblingNameTaken(session.user.id, parentId, name)) {
    return NextResponse.json(
      { error: `There is already a folder called "${name}" here.` },
      { status: 409 },
    );
  }

  const folder = await db.folder.create({
    data: { name, parentId, ownerId: session.user.id },
    select: { id: true, name: true, parentId: true },
  });

  return NextResponse.json(folder, { status: 201 });
}
