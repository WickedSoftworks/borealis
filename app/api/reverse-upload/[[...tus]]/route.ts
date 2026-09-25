import { db } from "@/lib/db";
import { getReverseTusServer } from "@/lib/tus-reverse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Anonymous by design — authorised by the reverse-share token, not a session. */
async function handler(req: Request): Promise<Response> {
  const response = await getReverseTusServer().handleWeb(req);
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
