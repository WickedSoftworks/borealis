import { db } from "@/lib/db";
import { GUESSING_THRESHOLD } from "@/lib/shares/attention";
import { LOCKOUT_WINDOW_MS } from "@/lib/shares/lockout";

export type Guessing = {
  shareId: string;
  failures: number;
  lastAt: Date;
};

/**
 * Live links of this owner with at least `GUESSING_THRESHOLD` wrong passwords
 * inside the lockout window, most recent first. The same window the lockout
 * itself counts, so "someone is guessing" and "the link is slowing them down"
 * describe the same attempts.
 */
export async function guessedLinks(
  ownerId: string,
  now: Date = new Date(),
): Promise<Guessing[]> {
  const rows = await db.shareAccess.groupBy({
    by: ["shareId"],
    where: {
      action: "UNLOCK_FAIL",
      createdAt: { gt: new Date(now.getTime() - LOCKOUT_WINDOW_MS) },
      share: { ownerId, revokedAt: null },
    },
    _count: { _all: true },
    _max: { createdAt: true },
  });

  return rows
    .filter((row) => row._count._all >= GUESSING_THRESHOLD)
    .map((row) => ({
      shareId: row.shareId,
      failures: row._count._all,
      lastAt: row._max.createdAt ?? now,
    }))
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}
