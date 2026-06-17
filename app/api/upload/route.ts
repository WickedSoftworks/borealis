import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
const generatedName = uuid();

// ensure uploads dir exists
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const filename = `${Date.now()}-${file.name}`;
  const filepath = path.join(uploadDir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());

  await fs.promises.writeFile(filepath, buffer);

  const saved = await db.file.create({
    data: {
      filename: generatedName,
      ogName: file.name,
      mimeType: file.type,
      size: file.size,
      filepath: `/uploads/${generatedName}`,
      storageKey: generatedName,

      ownerId: session.user.id,
    },
  });

  return NextResponse.json(saved);
}
