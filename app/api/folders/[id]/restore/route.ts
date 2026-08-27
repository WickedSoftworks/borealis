import { NextResponse } from "next/server";
import { restoreFolderTree } from "@/lib/folders";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Take a folder and its contents back out of the trash.
 *
 * Restores only what went down with this folder — matched on the shared
 * `deletedAt` — so a file deleted on its own last week stays deleted.
 *
 * Links stay revoked, matching the file restore endpoint: getting the files
 * back is not the same as re-opening links already handed to other people.
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

  const result = await restoreFolderTree(id, session.user.id);

  if (result === null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    restored: result.name,
    folders: result.folders,
    files: result.files,
  });
}
