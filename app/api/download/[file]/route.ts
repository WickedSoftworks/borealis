import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

export async function GET(
  // biome-ignore lint/correctness/noUnusedFunctionParameters: it's needed but not used here
  req: Request,
  { params }: { params: { file: string } },
) {
  const filePath = path.join(process.cwd(), "uploads", params.file);

  if (!fs.existsSync(filePath)) {
    return new Response("File not found", { status: 404 });
  }

  const fileBuffer = fs.readFileSync(filePath);

  return new Response(fileBuffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${params.file}"`,
    },
  });
}
