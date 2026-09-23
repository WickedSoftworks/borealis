import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Named, expiring claims on singleton duties.
 *
 * `instrumentation.ts` starts a worker in every server process, which is the
 * right default for one container and the wrong one for three: each replica
 * enqueued its own hourly sweep, so N replicas swept N times an hour. Jobs
 * themselves were already safe — `runOne()` claims with a PENDING-scoped
 * `updateMany`, so a job runs once however many workers poll — but a duty that
 * is not a job needs its own claim. That is this.
 *
 * A lease is one `Lease` row. Taking it is a conditional update — "set the
 * holder to me where it is expired or already mine" — so exactly one process
 * wins, and a crashed holder loses it when its time runs out rather than
 * holding it forever. No clock is shared except the database's view of rows,
 * which is why every comparison is written against `expiresAt`.
 */

/** Unique per process, so a restarted process is a new holder. */
export const HOLDER = `${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * Take or renew `name` for `ttlMs`. True if this process now holds it.
 *
 * The update runs first because it is the common case — renewing a lease we
 * already hold, or taking over an expired one — and the create only runs for
 * a name that has never been leased. A create that loses a race to another
 * process's create fails on the primary key and reports false.
 */
export async function acquireLease(
  name: string,
  ttlMs: number,
): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const taken = await db.lease.updateMany({
    where: {
      name,
      OR: [{ holder: HOLDER }, { expiresAt: { lt: now } }],
    },
    data: { holder: HOLDER, expiresAt },
  });

  if (taken.count > 0) return true;

  if (await db.lease.findUnique({ where: { name }, select: { name: true } })) {
    return false;
  }

  try {
    await db.lease.create({ data: { name, holder: HOLDER, expiresAt } });
    return true;
  } catch {
    // Exists and is held by someone else, or another process created it
    // between our update and this insert. Either way, not ours.
    return false;
  }
}

/**
 * Claim one run of a periodic duty — true at most once per `periodMs` across
 * every process.
 *
 * Unlike `acquireLease`, the holder gets no renewal: the row simply records
 * when the next run is due, and whoever first notices it is overdue takes it.
 * That is what an hourly sweep wants. A process that dies after claiming
 * costs one skipped period, not a stuck duty.
 */
export async function claimPeriod(
  name: string,
  periodMs: number,
): Promise<boolean> {
  const now = new Date();
  const next = new Date(now.getTime() + periodMs);

  const taken = await db.lease.updateMany({
    where: { name, expiresAt: { lte: now } },
    data: { holder: HOLDER, expiresAt: next },
  });

  if (taken.count > 0) return true;

  // Not due yet — the common answer, and one that must not go through a
  // failing insert: Prisma logs every constraint violation as an error, and
  // this runs every minute on every replica.
  if (await db.lease.findUnique({ where: { name }, select: { name: true } })) {
    return false;
  }

  try {
    await db.lease.create({ data: { name, holder: HOLDER, expiresAt: next } });
    return true;
  } catch {
    return false;
  }
}

/** Give a lease back early, so a clean shutdown does not leave a gap. */
export async function releaseLease(name: string): Promise<void> {
  await db.lease.deleteMany({ where: { name, holder: HOLDER } });
}
