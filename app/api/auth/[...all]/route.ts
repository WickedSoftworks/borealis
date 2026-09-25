import { toNextJsHandler } from "better-auth/next-js";
import { auth, CLIENT_IP_HEADER } from "@/lib/auth";
import { boundedAuthBody } from "@/lib/auth-body";
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
  // The admin plugin supplies role fields to better-auth sessions, but its
  // endpoints bypass Borealis's root/peer policy. Administration uses /api/admin.
  let authPath: string;
  try {
    authPath = decodeURIComponent(new URL(req.url).pathname)
      .replace(/\/+/g, "/")
      .toLowerCase();
  } catch {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }
  if (/^\/api\/auth\/admin(?:\/|$)/.test(authPath)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const address = rateLimitAddress(req);
  const { deniedIps } = await getSettings();

  if (deniedIps && ipMatchesList(address, parseCidrList(deniedIps).ranges)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const headers = new Headers(req.headers);
  headers.set(CLIENT_IP_HEADER, address);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await boundedAuthBody(req) : undefined;
  if (body === null) {
    return Response.json({ error: "Request body too large" }, { status: 413 });
  }

  return handler(
    new Request(req.url, {
      method: req.method,
      headers,
      body,
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
