import { db } from "@/lib/db";
import { contentDisposition } from "@/lib/http";
import { getSession } from "@/lib/session";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Owner-only download. Public, share-token access is a separate route
 * (/api/s/[token]) so that the share guard is the only path that can ever
 * serve bytes to an unauthenticated caller.
 */
export async function GET(
  _req: Request,
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

  const buffer = await storage.download(file.storageKey);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(buffer.byteLength),
      "Content-Disposition": contentDisposition(file.originalName),
    },
  });
}
