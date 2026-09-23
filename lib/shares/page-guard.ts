import { cookies, headers } from "next/headers";
import { after } from "next/server";
import type { Share } from "@/lib/generated/prisma/client";
import { clientIp, parseCidrList } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { recordDenied } from "./denied";
import { type GuardResult, guardShare, unlockCookieName } from "./guard";

/**
 * The guard for a server-rendered share page — the page-side twin of
 * lib/shares/request.ts, reading the same three inputs from Next's request
 * APIs instead of from a Request object. The page and the byte routes must
 * refuse exactly the same callers, or the page would show files its own
 * download buttons cannot fetch.
 */
export async function guardSharePage(share: Share): Promise<GuardResult> {
  const [cookieStore, headerStore, { deniedIps }] = await Promise.all([
    cookies(),
    headers(),
    getSettings(),
  ]);

  const address = clientIp(headerStore);

  const verdict = guardShare(share, {
    intent: "metadata",
    unlockToken: cookieStore.get(unlockCookieName(share.id))?.value,
    address,
    deniedRanges: parseCidrList(deniedIps).ranges,
  });

  if (!verdict.ok && verdict.reason === "ADDRESS_DENIED") {
    const userAgent = headerStore.get("user-agent");
    after(() => recordDenied(share.id, address, userAgent));
  }

  return verdict;
}
