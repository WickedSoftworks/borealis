import { getReverseTusServer } from "@/lib/tus-reverse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Anonymous by design — authorised by the reverse-share token, not a session. */
function handler(req: Request): Promise<Response> {
  return getReverseTusServer().handleWeb(req);
}

export {
  handler as DELETE,
  handler as GET,
  handler as HEAD,
  handler as OPTIONS,
  handler as PATCH,
  handler as POST,
};
