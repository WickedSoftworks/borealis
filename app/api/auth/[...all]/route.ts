import { toNextJsHandler } from "better-auth/next-js";
import { auth, CLIENT_IP_HEADER } from "@/lib/auth";
import { ipMatchesList, parseCidrList, rateLimitAddress } from "@/lib/request";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);

/**
 * Hand better-auth an address it can trust, and nothing else.
 *
 * Whatever the client put in CLIENT_IP_HEADER is discarded and replaced with
 * the address lib/request.ts resolves under TRUST_PROXY, so the sign-in rate
 * limiter and the address stored on each session follow the same policy as
 * the rest of the product (see CLIENT_IP_HEADER in lib/auth.ts).
 *
 * The instance deny list applies here too: an address an operator has refused
 * should not get to try passwords either.
 */
async function withClientAddress(
  req: Request,
  handler: (req: Request) => Promise<Response>,
): Promise<Response> {
  const address = rateLimitAddress(req);
  const { deniedIps } = await getSettings();

  if (deniedIps && ipMatchesList(address, parseCidrList(deniedIps).ranges)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const headers = new Headers(req.headers);
  headers.set(CLIENT_IP_HEADER, address);

  // Rebuilt from a buffered body rather than by passing `req` through: Node's
  // Request refuses a streamed body without `duplex`, and auth payloads are a
  // few hundred bytes of JSON at most.
  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  return handler(
    new Request(req.url, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      signal: req.signal,
    }),
  );
}

export function GET(req: Request) {
  return withClientAddress(req, handlers.GET);
}

export function POST(req: Request) {
  return withClientAddress(req, handlers.POST);
}
