import { db } from "@/lib/db";
import { serveFile } from "@/lib/download";
import { previewable, TEXT_PREVIEW_BYTES } from "@/lib/preview";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * The owner's own preview. Same allowlist and the same inline framing as the
 * recipient's (lib/preview.ts), because the danger is the bytes, not who is
 * looking at them: an owner who uploaded a hostile HTML file must not be able
 * to render it on the origin that holds their session either.
 *
 * Not counted anywhere — like the owner download route beside it, reading your
 * own file is not an event anything accounts for.
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

  if (!file) return new Response("Not found", { status: 404 });

  const preview = previewable(file);

  if (!preview) {
    return new Response("This file cannot be previewed.", { status: 415 });
  }

  const truncated =
    preview.kind === "text" && file.size > BigInt(TEXT_PREVIEW_BYTES);

  const response = await serveFile({
    file,
    rangeHeader: truncated
      ? `bytes=0-${TEXT_PREVIEW_BYTES - 1}`
      : req.headers.get("range"),
    inline: { contentType: preview.contentType },
  });

  if (truncated) response.headers.set("X-Borealis-Truncated", "true");

  return response;
}
