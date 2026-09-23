import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { folderNameSchema } from "@/lib/folder-name";
import {
  assertOwnedFolder,
  depthOf,
  folderRows,
  MAX_FOLDER_DEPTH,
} from "@/lib/folders";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const schema = z.object({
  parentId: z.string().nullable(),
  path: z.array(folderNameSchema).min(1).max(MAX_FOLDER_DEPTH),
});

/**
 * Make sure a folder path exists under `parentId`, and return its last folder.
 *
 * For uploading a whole folder from disk: `Photos/2024/raw/a.jpg` needs
 * `Photos`, `Photos/2024`, and `Photos/2024/raw` before the file has somewhere
 * to land. An existing folder with the same name — compared the way the
 * sibling-name rule compares, ignoring case — is reused rather than
 * duplicated, so uploading the same folder twice fills one tree instead of
 * growing a second.
 */
export async function POST(req: Request) {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const ownerId = session.user.id;
  const { parentId, path } = parsed.data;

  if (
    parentId !== null &&
    (await assertOwnedFolder(parentId, ownerId)) === null
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const startDepth =
    parentId === null ? 0 : depthOf(await folderRows(ownerId), parentId);

  if (startDepth + path.length > MAX_FOLDER_DEPTH) {
    return NextResponse.json(
      { error: `Folders cannot nest deeper than ${MAX_FOLDER_DEPTH}.` },
      { status: 409 },
    );
  }

  let current = parentId;

  for (const name of path) {
    const siblings = await db.folder.findMany({
      where: { ownerId, parentId: current, deletedAt: null },
      select: { id: true, name: true },
    });

    const wanted = name.trim().toLocaleLowerCase();
    const existing = siblings.find(
      (sibling) => sibling.name.trim().toLocaleLowerCase() === wanted,
    );

    if (existing) {
      current = existing.id;
      continue;
    }

    const created = await db.folder.create({
      data: { name, parentId: current, ownerId },
      select: { id: true },
    });

    current = created.id;
  }

  return NextResponse.json({ folderId: current });
}
