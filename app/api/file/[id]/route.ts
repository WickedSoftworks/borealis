import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

export async function GET(
  // biome-ignore lint/correctness/noUnusedFunctionParameters: aughhhhhhhhhh
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const fileRecord = await db.file.findUnique({
    where: {
      id,
    },
  });

  if (!fileRecord) {
    return new Response("Not found", {
      status: 404,
    });
  }

  const buffer = await storage.download(fileRecord.storageKey);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": fileRecord.mimeType,
      "Content-Disposition": `attachment; filename="${fileRecord.ogName}"`,
    },
  });
}
