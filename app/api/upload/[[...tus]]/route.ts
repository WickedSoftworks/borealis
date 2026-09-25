import { db } from "@/lib/db";
import { getTusServer } from "@/lib/tus";

export const runtime = "nodejs";
// tus streams the body in chunks; Next must not try to cache or statically
// analyse these responses.
export const dynamic = "force-dynamic";

async function handler(req: Request): Promise<Response> {
  const response = await getTusServer().handleWeb(req);
  if (req.method === "DELETE" && response.status === 204) {
    const id = new URL(req.url).pathname.split("/").at(-1);
    if (id) await db.uploadReservation.deleteMany({ where: { id } });
  }
  return response;
}

export {
  handler as DELETE,
  handler as GET,
  handler as HEAD,
  handler as OPTIONS,
  handler as PATCH,
  handler as POST,
};
