import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { serveFile } from "@/lib/download";
import { fileNameSchema } from "@/lib/file-name";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Owner-only download. Public, share-token access is a separate route
 * (/api/s/[token]) so that the share guard is the only path that can ever
 * serve bytes to an unauthenticated caller.
 *
 * No accounting here: egress caps and the audit trail belong to shares, and
 * an owner reading their own file is not an event anything counts.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const file = await db.file.findFirst({
    where: { id, ownerId: session.user.id, deletedAt: null },
  });

  // Same 404 whether it's missing or someone else's — don't leak existence.
  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  return serveFile({ file, rangeHeader: req.headers.get("range") });
}

const renameSchema = z.object({ name: fileNameSchema });

/**
 * Rename a file. Owner only, live files only, scoped in the write itself.
 *
 * The new name reaches recipients immediately — a share lists files by their
 * current name — which is the point, and the reason there is no "rename for
 * me only". The stored bytes and every link stay exactly as they were.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = renameSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid name" },
      { status: 400 },
    );
  }

  const updated = await db.file.updateMany({
    where: { id, ownerId: session.user.id, deletedAt: null },
    data: { originalName: parsed.data.name },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, name: parsed.data.name });
}
