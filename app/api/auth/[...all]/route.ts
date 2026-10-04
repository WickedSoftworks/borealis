import { createHash } from "node:crypto";
import { toNextJsHandler } from "better-auth/next-js";
import { auth, CLIENT_IP_HEADER } from "@/lib/auth";
import { hit, type RateRule, RULES } from "@/lib/rate-limit";
import { ipMatchesList, parseCidrList, rateLimitAddress } from "@/lib/request";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);

/**
 * Endpoints that name an account in their body, and that account's budget.
 *
 * better-auth's own limits on these are per address, and an address is only
 * as trustworthy as TRUST_PROXY makes it: without it, the client writes its
 * own `X-Forwarded-For`, and a guesser who changes it on every request never
 * meets a limit. These hold however the address is spoofed.
 */
const PER_ACCOUNT: Record<
  string,
  { name: string; rule: RateRule; message: string }
> = {
  "/api/auth/sign-in/email": {
    name: "sign-in",
    rule: RULES.signInPerAccount,
    message:
      "Too many sign-in attempts for this account. Wait a few minutes and try again.",
  },
  "/api/auth/request-password-reset": {
    name: "password-reset",
    rule: RULES.passwordResetPerAccount,
    message:
      "Too many reset emails asked for this address. Wait a while and try again.",
  },
};

/**
 * The path as the router will see it, give or take: decoded, lowercased, no
 * trailing slash. Matching loosely errs towards counting a request, never
 * towards letting a spelling variant past the limit.
 */
function normalizedPath(url: string): string {
  const { pathname } = new URL(url);
  let decoded = pathname;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Keep it as sent; a malformed escape matches nothing below.
  }

  return decoded.toLowerCase().replace(/\/+$/, "");
}

/** A 429 for the account named in `body`, or null when it may proceed. */
async function perAccountRefusal(
  path: string,
  body: ArrayBuffer,
): Promise<Response | null> {
  const limit = PER_ACCOUNT[path];
  if (!limit) return null;

  let email: unknown;

  try {
    email = JSON.parse(new TextDecoder().decode(body))?.email;
  } catch {
    return null;
  }

  if (typeof email !== "string" || !email.trim()) return null;

  // Hashed so the limiter table never holds a list of addresses. Any string
  // is counted, existing account or not, so the answer reveals nothing.
  const account = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
  const decision = await hit(`${limit.name}:${account}`, limit.rule);

  if (decision.allowed) return null;

  // better-auth's own shape for a 429, which its client already reads.
  return Response.json(
    { message: limit.message, code: "TOO_MANY_REQUESTS" },
    {
      status: 429,
      headers: {
        "Retry-After": String(decision.retryAfterSeconds),
        "X-Retry-After": String(decision.retryAfterSeconds),
      },
    },
  );
}

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
  const body =
    req.method !== "GET" && req.method !== "HEAD"
      ? await req.arrayBuffer()
      : undefined;

  if (body) {
    const refusal = await perAccountRefusal(normalizedPath(req.url), body);
    if (refusal) return refusal;
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
