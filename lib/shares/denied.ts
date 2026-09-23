import { db } from "@/lib/db";

/** One row per link per address per this long — enough to see it, not enough to flood. */
const THROTTLE_MS = 10 * 60 * 1000;

/**
 * Record that someone outside a link's allow list tried to open it.
 *
 * The allow list exists because the owner decided who should reach the link,
 * and a refusal is exactly the event they would want to know about — the same
 * reason failed passwords sit in the access log. Throttled, so a script
 * hammering the page writes a handful of rows rather than thousands.
 */
export async function recordDenied(
  shareId: string,
  address: string | null,
  userAgent: string | null,
): Promise<void> {
  const recent = await db.shareAccess.findFirst({
    where: {
      shareId,
      action: "DENIED",
      ipAddress: address,
      createdAt: { gt: new Date(Date.now() - THROTTLE_MS) },
    },
    select: { id: true },
  });

  if (recent) return;

  await db.shareAccess.create({
    data: { shareId, action: "DENIED", ipAddress: address, userAgent },
  });
}
