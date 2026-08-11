import { getTusServer } from "@/lib/tus";

export const runtime = "nodejs";
// tus streams the body in chunks; Next must not try to cache or statically
// analyse these responses.
export const dynamic = "force-dynamic";

function handler(req: Request): Promise<Response> {
  return getTusServer().handleWeb(req);
}

export {
  handler as DELETE,
  handler as GET,
  handler as HEAD,
  handler as OPTIONS,
  handler as PATCH,
  handler as POST,
};
