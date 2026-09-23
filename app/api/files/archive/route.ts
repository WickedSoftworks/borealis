import {
  type ArchiveFile,
  archiveName,
  archiveResponse,
  noteEntry,
  omissionsNote,
  planArchive,
} from "@/lib/archive";
import { db } from "@/lib/db";
import { descendantsOf, folderRows, pathTo } from "@/lib/folders";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Download a selection of your own files and folders as one ZIP.
 *
 * A form POST rather than a fetch: the browser then treats the response as an
 * ordinary download and streams it to disk, where a fetch would have to hold
 * the whole archive in memory as a blob before it could be saved. Session
 * cookies are SameSite=Lax, so another site cannot submit this form on the
 * owner's behalf.
 *
 * Folders keep their shape inside the archive. Encrypted files are left out —
 * the server holds ciphertext — and listed in a note, as on a share.
 */
export async function POST(req: Request) {
  const session = await getSession();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const form = await req.formData().catch(() => null);

  if (!form) return new Response("Invalid request", { status: 400 });

  const fileIds = form.getAll("fileId").map(String).slice(0, 5000);
  const folderIds = form.getAll("folderId").map(String).slice(0, 500);

  if (fileIds.length === 0 && folderIds.length === 0) {
    return new Response("Nothing selected", { status: 400 });
  }

  const ownerId = session.user.id;
  const rows = await folderRows(ownerId);
  const live = new Set(rows.map((row) => row.id));

  // Each selected folder brings its subtree, pathed from the selected folder
  // itself — "Photos/2024/a.jpg", not the whole ancestry above it.
  const folderPath = new Map<string, string>();

  for (const rootId of folderIds.filter((id) => live.has(id))) {
    const root = rows.find((row) => row.id === rootId);
    if (!root) continue;

    folderPath.set(rootId, root.name);

    for (const node of descendantsOf(rows, rootId)) {
      const trail = pathTo(rows, node.id);
      const start = trail.findIndex((row) => row.id === rootId);
      folderPath.set(
        node.id,
        trail
          .slice(start)
          .map((row) => row.name)
          .join("/"),
      );
    }
  }

  const files = await db.file.findMany({
    where: {
      ownerId,
      deletedAt: null,
      OR: [
        { id: { in: fileIds } },
        { folderId: { in: [...folderPath.keys()] } },
      ],
    },
    select: {
      id: true,
      originalName: true,
      storageKey: true,
      size: true,
      createdAt: true,
      folderId: true,
      isEncrypted: true,
    },
    orderBy: { originalName: "asc" },
  });

  const direct = new Set(fileIds);
  const included: ArchiveFile[] = [];
  const omitted: Array<{ path: string; reason: string }> = [];

  for (const file of files) {
    // A file picked by name sits at the top of the archive even when it also
    // lives inside a picked folder — the same rule the share tree uses.
    const prefix =
      !direct.has(file.id) && file.folderId
        ? folderPath.get(file.folderId)
        : undefined;
    const path = prefix ? `${prefix}/${file.originalName}` : file.originalName;

    if (file.isEncrypted) {
      omitted.push({
        path,
        reason: "encrypted in the browser that uploaded it",
      });
      continue;
    }

    included.push({
      id: file.id,
      path,
      storageKey: file.storageKey,
      size: file.size,
      createdAt: file.createdAt,
    });
  }

  if (included.length === 0) {
    return new Response(
      "Nothing selected can be archived by the server. Encrypted files download one at a time.",
      { status: 409 },
    );
  }

  const plan = planArchive(
    included,
    omitted.length > 0 ? [noteEntry(omissionsNote(omitted))] : [],
  );

  const single =
    folderIds.length === 1 && fileIds.length === 0
      ? rows.find((row) => row.id === folderIds[0])?.name
      : null;

  return archiveResponse({ plan, filename: archiveName(single ?? "vault") });
}
