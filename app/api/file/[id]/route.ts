import { db } from "@/lib/db";
import { serveFile } from "@/lib/download";
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
