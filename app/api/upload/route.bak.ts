import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  // Make sure the user has a session
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  // If they don't, they shouldn't be here
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get the file from where it's being uploaded and assume it's a file
  const formData = await req.formData();
  const file = formData.get("file") as File;

  // If there isn't a file, we can't do anything with it
  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  // Generate a new name for the file and keep it as the same format
  const ext = path.extname(file.name);
  const generatedName = `${uuid()}${ext}`;

  // Store the file in the uploads directory and save a record in the database with the path to it
  const storedPath = `/uploads/${generatedName}`;

  // Ensure the uploads directory exists
  const uploadDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const storageKey = `${session.user.id}/${uuid()}`;

  fs.writeFileSync(`.${storedPath}`, buffer);

  const saved = await db.file.create({
    data: {
      filename: generatedName,
      ogName: file.name,
      mimeType: file.type,
      size: file.size,
      filepath: storedPath,
      storageKey,

      ownerId: session.user.id,
    },
  });
  return Response.json(saved);
}
