import { db } from "@/lib/db";
import type { Share } from "@/lib/generated/prisma/client";
import type { GuardFailure } from "./guard";

/**
 * Spending a share's caps.
 *
 * The guard reads the counters and says whether a request may start, but it
 * holds nothing while the bytes stream. The cost used to be written only once
 * a body had finished, so any number of downloads started together all
 * passed against the same remaining budget.
 *
 * Now a request reserves what it may cost before its first byte, in one
 * conditional write that cannot pass two callers against one remainder, and
 * settles to what really went out once its body ends. Downloads are in
 * whole-file equivalents (lib/shares/downloads.ts); bytes are bytes.
 *
 * A process that dies between the two writes leaves its reservation spent.
 * That is the safe way round for a cap.
 */

/** What a request costs: download equivalents, and bytes of egress. */
export type Charge = { downloads: number; bytes: bigint };

/** The counters are floats; see lib/shares/downloads.ts. */
const EPSILON = 1e-9;

/**
 * Take `charge` from the share's caps, or say which one is spent.
 *
 * A download may start while any of the cap is left (it may overshoot by
 * less than one); egress must fit whole, as the guard's pre-check already
 * required. Uncapped counters are still counted, so the owner sees usage.
 */
export async function reserve(
  share: Pick<Share, "id" | "maxDownloads" | "egressLimitBytes">,
  charge: Charge,
): Promise<GuardFailure | null> {
  const capsDownloads = share.maxDownloads !== null && charge.downloads > 0;
  const capsEgress = share.egressLimitBytes !== null && charge.bytes > 0n;

  const { count } = await db.share.updateMany({
    where: {
      id: share.id,
      ...(capsDownloads && {
        downloadCount: { lt: (share.maxDownloads ?? 0) - EPSILON },
      }),
      ...(capsEgress && {
        egressUsedBytes: { lte: (share.egressLimitBytes ?? 0n) - charge.bytes },
      }),
    },
    data: {
      downloadCount: { increment: charge.downloads },
      egressUsedBytes: { increment: charge.bytes },
    },
  });

  if (count === 1) return null;

  // Refused. Read back which cap it was, for the right answer.
  const now = await db.share.findUnique({
    where: { id: share.id },
    select: { downloadCount: true },
  });

  if (!now) return "NOT_FOUND";

  return capsDownloads &&
    now.downloadCount >= (share.maxDownloads ?? 0) - EPSILON
    ? "DOWNLOAD_LIMIT"
    : "EGRESS_LIMIT";
}

/**
 * The write that turns a reservation into what was really spent, for the
 * caller's transaction. Only ever gives back: a body cannot carry more than
 * was reserved for it.
 */
export function settle(shareId: string, reserved: Charge, actual: Charge) {
  return db.share.updateMany({
    where: { id: shareId },
    data: {
      downloadCount: {
        decrement: Math.max(0, reserved.downloads - actual.downloads),
      },
      egressUsedBytes: {
        decrement:
          reserved.bytes > actual.bytes ? reserved.bytes - actual.bytes : 0n,
      },
    },
  });
}

/** Give a reservation back whole: nothing was served after all. */
export async function release(shareId: string, reserved: Charge) {
  await settle(shareId, reserved, { downloads: 0, bytes: 0n });
}
