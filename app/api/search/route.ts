import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { search } from "@/lib/search";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Search within your own files, by filename and by document contents.
 *
 * Scoped to the caller at every level. Being an admin permits deleting a
 * user's files; it does not permit reading them, and search would be exactly
 * that.
 */
export async function GET(req: Request) {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  if (query.length < 2) {
    return NextResponse.json({ files: [], contents: [] });
  }

  const [files, contents] = await Promise.all([
    db.file.findMany({
      where: {
        ownerId: session.user.id,
        deletedAt: null,
        originalName: { contains: query },
      },
      take: 25,
      orderBy: { createdAt: "desc" },
      select: { id: true, originalName: true, size: true },
    }),
    search.search(session.user.id, query),
  ]);

  const byName = new Set(files.map((file) => file.id));

  return NextResponse.json({
    files: files.map((file) => ({ ...file, size: Number(file.size) })),
    // Content hits that the filename search already covered would just be
    // the same row twice.
    contents: contents.filter((hit) => !byName.has(hit.fileId)),
  });
}
