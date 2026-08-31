import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Scoped to the owner. The previous implementation readdir'd the upload
  // directory and returned every file on the box to any caller.
  const files = await db.file.findMany({
    where: { ownerId: session.user.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      size: true,
      createdAt: true,
      // The share item picker groups by folder, and warns before adding an
      // encrypted file to a link that has already been sent.
      folderId: true,
      isEncrypted: true,
    },
  });

  return NextResponse.json({
    files: files.map((file) => ({ ...file, size: Number(file.size) })),
  });
}
