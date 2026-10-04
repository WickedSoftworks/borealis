import { getReverseTusServer } from "@/lib/tus-reverse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Anonymous by design — authorised by the reverse-share token, not a session. */
function handler(req: Request): Promise<Response> {
  return getReverseTusServer().handleWeb(req);
}

// No GET: tus would serve a finished upload's raw bytes on it, to anyone,
// around every rule the share routes apply. Uploading never needs it.
export {
  handler as DELETE,
  handler as HEAD,
  handler as OPTIONS,
  handler as PATCH,
  handler as POST,
};
