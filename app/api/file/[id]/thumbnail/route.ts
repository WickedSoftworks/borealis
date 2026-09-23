import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { serveThumbnail } from "@/lib/thumbnail-response";

export const runtime = "nodejs";

/** The owner's thumbnail, for the vault's file list. Owner-only, like download. */
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
    where: { id, ownerId: session.user.id },
    select: { thumbnailKey: true },
  });

  return serveThumbnail(file?.thumbnailKey ?? null, { shared: false });
}
