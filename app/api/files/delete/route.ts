import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { purgeDueAt } from "@/lib/purge";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const schema = z.object({
  fileIds: z.array(z.string()).min(1).max(1000),
});

/**
 * Move a selection of your own files to the trash, as one act.
 *
 * Own files only — the moderation path, deleting someone else's file outright,
 * stays one file at a time through `POST /api/file/[id]/delete`, where each
 * one is audited. Every file gets the same `deletedAt`, and every link that
 * carried any of them is revoked, for the same reasons the single-file delete
 * gives. The counts come back so the interface can say what happened.
 */
export async function POST(req: Request) {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const deletedAt = new Date();

  const result = await db.$transaction(async (tx) => {
    const files = await tx.file.findMany({
      where: {
        id: { in: parsed.data.fileIds },
        ownerId: session.user.id,
        deletedAt: null,
      },
      select: { id: true },
    });

    const ids = files.map((file) => file.id);

    if (ids.length === 0) return { trashed: 0, revokedShares: 0 };

    const shareIds = (
      await tx.shareItem.findMany({
        where: { fileId: { in: ids } },
        select: { shareId: true },
      })
    ).map((item) => item.shareId);

    const revoked =
      shareIds.length === 0
        ? { count: 0 }
        : await tx.share.updateMany({
            where: { id: { in: shareIds }, revokedAt: null },
            data: { revokedAt: new Date() },
          });

    const trashed = await tx.file.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt },
    });

    return { trashed: trashed.count, revokedShares: revoked.count };
  });

  return NextResponse.json({
    ok: true,
    ...result,
    purgeAt: purgeDueAt(deletedAt).toISOString(),
  });
}
