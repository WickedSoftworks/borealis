import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertOwnedFolder, sharesCoveringFolder } from "@/lib/folders";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const moveSchema = z.object({
  fileIds: z.array(z.string()).min(1).max(1000),
  /** Null means the root of the vault. */
  folderId: z.string().nullable(),
});

/**
 * Move files between folders.
 *
 * Bulk by design: this backs both a drag of a multi-selection and the Move
 * action in the file table, and one round trip for twenty files is the
 * difference between an instant move and a visible stutter.
 *
 * Reports `published` when the destination sits inside a live link. Folder
 * shares resolve on every request, so dropping a file into a shared folder
 * hands it to whoever holds that link, immediately. That is the feature working
 * as designed and the easiest way to leak something by accident, so it is said
 * out loud rather than left to be discovered.
 */
export async function POST(req: Request) {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = moveSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { fileIds, folderId } = parsed.data;

  if (folderId !== null) {
    if ((await assertOwnedFolder(folderId, session.user.id)) === null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  // Scoped to the owner and to live files in the write itself. A file that is
  // not this account's simply does not match, so a forged id moves nothing
  // rather than erroring in a way that confirms the file exists.
  const moved = await db.file.updateMany({
    where: { id: { in: fileIds }, ownerId: session.user.id, deletedAt: null },
    data: { folderId },
  });

  const published =
    folderId === null || moved.count === 0
      ? 0
      : await sharesCoveringFolder(folderId, session.user.id);

  return NextResponse.json({ ok: true, moved: moved.count, published });
}
