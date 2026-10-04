import { getTusServer } from "@/lib/tus";

export const runtime = "nodejs";
// tus streams the body in chunks; Next must not try to cache or statically
// analyse these responses.
export const dynamic = "force-dynamic";

function handler(req: Request): Promise<Response> {
  return getTusServer().handleWeb(req);
}

// No GET: tus would serve a finished upload's raw bytes on it, around every
// rule the file routes apply. Uploading never needs it.
export {
  handler as DELETE,
  handler as HEAD,
  handler as OPTIONS,
  handler as PATCH,
  handler as POST,
};
