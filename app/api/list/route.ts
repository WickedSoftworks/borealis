import fs from "node:fs";
import path from "node:path";

export async function GET() {
  const dir = path.join(process.cwd(), "uploads");

  if (!fs.existsSync(dir)) {
    return Response.json({ files: [] });
  }

  const files = fs.readdirSync(dir);

  return Response.json({ files });
}
