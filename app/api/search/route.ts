import { NextResponse } from "next/server";
import { descendantsOf, folderRows } from "@/lib/folders";
import { previewable } from "@/lib/preview";
import { search } from "@/lib/search";
import { hasCriteria, parseSearchParams } from "@/lib/search/params";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Search within your own files, by filename and by document contents, with
 * filters for type, folder, date, and size, one page at a time.
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

  const params = parseSearchParams(new URL(req.url).searchParams);

  if (!hasCriteria(params)) {
    return NextResponse.json({ total: 0, offset: 0, hits: [] });
  }

  // A folder filter means that folder and everything under it; a folder id
  // that is not this account's resolves to nothing rather than to everything.
  let folderScope: string[] | null = null;

  if (params.folderId) {
    const rows = await folderRows(session.user.id);
    folderScope = rows.some((row) => row.id === params.folderId)
      ? [
          params.folderId,
          ...descendantsOf(rows, params.folderId).map((row) => row.id),
        ]
      : [];
  }

  const result = await search.query(session.user.id, params, folderScope);

  return NextResponse.json({
    total: result.total,
    offset: params.offset,
    limit: params.limit,
    hits: result.hits.map((hit) => ({
      ...hit,
      size: Number(hit.size),
      createdAt: hit.createdAt.toISOString(),
      previewKind:
        previewable({
          mimeType: hit.mimeType,
          isEncrypted: hit.isEncrypted,
          size: hit.size,
        })?.kind ?? null,
    })),
  });
}
