import type { Share } from "@/lib/generated/prisma/client";
import { clientIp, parseCidrList } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import {
  GUARD_STATUS,
  type GuardResult,
  guardShare,
  readUnlockCookie,
  type ShareIntent,
} from "./guard";

/**
 * The request-shaped half of the share guard.
 *
 * `guardShare` is pure and takes everything as arguments, which is what makes
 * it testable. Every public route then had to assemble those arguments — the
 * unlock cookie, the caller's address, the instance deny list — and a route
 * that forgot one would be a route with a hole in it. They are assembled here
 * once, so the download, preview, thumbnail, and archive routes cannot
 * disagree about who may pass.
 */
export async function guardShareRequest(
  req: Request,
  share: Share | null,
  { intent, bytes }: { intent: ShareIntent; bytes?: bigint },
): Promise<{ verdict: GuardResult; address: string | null }> {
  const address = clientIp(req);
  const { deniedIps } = await getSettings();

  const verdict = guardShare(share, {
    intent,
    bytes,
    address,
    deniedRanges: parseCidrList(deniedIps).ranges,
    unlockToken: share
      ? readUnlockCookie(req.headers.get("cookie"), share.id)
      : undefined,
  });

  return { verdict, address };
}

/** The refusal a byte route sends for a failed guard. */
export function guardRefusal(
  verdict: Extract<GuardResult, { ok: false }>,
): Response {
  return new Response(verdict.reason, {
    status: GUARD_STATUS[verdict.reason],
    headers: { "X-Borealis-Reason": verdict.reason },
  });
}

/**
 * Whether a file may leave through a public link at all, independent of the
 * share's own rules. A file the scanner flagged stays reachable by its owner —
 * who may need to inspect or delete it — and by nobody else.
 */
export function publiclyServable(file: { scanStatus: string | null }): boolean {
  return file.scanStatus !== "INFECTED";
}
