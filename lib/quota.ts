import { db } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import { getSettings } from "@/lib/settings";

/**
 * Storage quotas.
 *
 * Three ceilings, checked in this order, all optional:
 *
 *   per file      `MAX_UPLOAD_SIZE`   the largest single upload
 *   per account   `storageQuotaBytes` on the user, else `DEFAULT_QUOTA`
 *   per instance  `STORAGE_CEILING`   everything, everyone
 *
 * Checked at tus `onUploadCreate`, where the client has declared the size
 * but sent no bytes — refusing after 4 GB have landed would cost the disk the
 * quota exists to protect. Principle 3 still holds: every ceiling is one the
 * operator chose, and an instance with none configured has none.
 *
 * Trash counts. Its bytes are still on the disk, and a quota that could be
 * dodged by deleting and restoring is not a quota; the dashboard says how much
 * of the usage is trash so emptying it is the obvious fix.
 *
 * Uploads still in flight count too, at their declared size, through an
 * `UploadReservation` each takes as it starts (reserveUpload, below). Without
 * them any number of uploads started before the first one finished were each
 * checked against usage that left all the others out — the overshoot was
 * bounded by nothing, and through a collection link the uploader is a
 * stranger.
 */

export type Usage = {
  /** Live files plus trash, in bytes. */
  used: bigint;
  trash: bigint;
  /** Promised to uploads that have started and not finished. */
  reserved: bigint;
  /** Null means unlimited. */
  limit: bigint | null;
};

export type QuotaInput = {
  size: bigint;
  account: Usage;
  instanceUsed: bigint;
  instanceCeiling: bigint | null;
  maxUpload: bigint | null;
};

export type QuotaRefusal = {
  reason: "FILE_TOO_LARGE" | "ACCOUNT_FULL" | "INSTANCE_FULL";
  /** For the account's owner: specific, with numbers and a way out. */
  message: string;
};

const fmt = (bytes: bigint) => formatBytes(Number(bytes));

/** The arithmetic. Pure, so each ceiling's edge is testable on its own. */
export function quotaVerdict(input: QuotaInput): QuotaRefusal | null {
  const { size, account, instanceUsed, instanceCeiling, maxUpload } = input;

  if (maxUpload !== null && size > maxUpload) {
    return {
      reason: "FILE_TOO_LARGE",
      message: `This file is ${fmt(size)}; this instance accepts files up to ${fmt(maxUpload)}.`,
    };
  }

  const committed = account.used + account.reserved;

  if (account.limit !== null && committed + size > account.limit) {
    const left = account.limit > committed ? account.limit - committed : 0n;
    const trashHint =
      account.trash > 0n
        ? ` Emptying the trash would free ${fmt(account.trash)}.`
        : "";

    return {
      reason: "ACCOUNT_FULL",
      message: `This file is ${fmt(size)} and your account has ${fmt(left)} left of its ${fmt(account.limit)}.${trashHint}`,
    };
  }

  if (instanceCeiling !== null && instanceUsed + size > instanceCeiling) {
    return {
      reason: "INSTANCE_FULL",
      message:
        "This instance is out of space for new uploads. Ask whoever runs it to raise the storage ceiling or free some room.",
    };
  }

  return null;
}

/**
 * An account's usage and effective limit. `except` leaves one reservation out
 * of the sum — the caller's own, when it is asking whether that one fits.
 */
export async function accountUsage(
  userId: string,
  { except }: { except?: string } = {},
): Promise<Usage> {
  const [user, all, trash, reserved, settings] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { storageQuotaBytes: true },
    }),
    db.file.aggregate({ where: { ownerId: userId }, _sum: { size: true } }),
    db.file.aggregate({
      where: { ownerId: userId, deletedAt: { not: null } },
      _sum: { size: true },
    }),
    db.uploadReservation.aggregate({
      where: { ownerId: userId, ...(except && { id: { not: except } }) },
      _sum: { bytes: true },
    }),
    getSettings(),
  ]);

  return {
    used: all._sum.size ?? 0n,
    trash: trash._sum.size ?? 0n,
    reserved: reserved._sum.bytes ?? 0n,
    limit: user?.storageQuotaBytes ?? settings.defaultQuotaBytes,
  };
}

/** Bytes stored, everyone's. What the disk holds now; see instanceCommitted. */
export async function instanceUsage(): Promise<bigint> {
  const total = await db.file.aggregate({ _sum: { size: true } });
  return total._sum.size ?? 0n;
}

/** Bytes stored plus bytes promised to uploads in flight, everyone's. */
async function instanceCommitted(except?: string): Promise<bigint> {
  const [stored, reserved] = await Promise.all([
    instanceUsage(),
    db.uploadReservation.aggregate({
      where: except ? { id: { not: except } } : {},
      _sum: { bytes: true },
    }),
  ]);

  return stored + (reserved._sum.bytes ?? 0n);
}

/**
 * Whether `userId` may store `size` more bytes, and if not, why.
 *
 * Skips the instance-wide sum when no ceiling is set — it is a scan of every
 * file row, and the answer would not be used.
 */
export async function checkQuota(
  userId: string,
  size: bigint,
  { except }: { except?: string } = {},
): Promise<QuotaRefusal | null> {
  const settings = await getSettings();

  const [account, instanceUsed] = await Promise.all([
    accountUsage(userId, { except }),
    settings.storageCeilingBytes === null
      ? Promise.resolve(0n)
      : instanceCommitted(except),
  ]);

  return quotaVerdict({
    size,
    account,
    instanceUsed,
    instanceCeiling: settings.storageCeilingBytes,
    maxUpload: settings.maxUploadBytes,
  });
}

export type UploadClaim = {
  /** The tus upload id. */
  id: string;
  ownerId: string;
  bytes: bigint;
  /** A collection link the upload arrives through, and its file limit. */
  share?: { id: string; maxUploadFiles: number | null };
};

export type ReservationRefusal = QuotaRefusal | { reason: "LINK_FULL" };

/**
 * Hold space for an upload about to start, or say why it cannot have it.
 *
 * Written first and checked after, against every reservation but this one —
 * including any a racing upload has just written. Two uploads competing for
 * the last of a quota each see the other, so neither is admitted on usage
 * that leaves the other out. Under that contention both may be refused where
 * one alone would fit; that is the safe way to be wrong, and it needs no
 * lock, which neither database would give the same way.
 *
 * A collection link's file limit is held the same way: files already in it
 * plus uploads on their way to it.
 */
export async function reserveUpload(
  claim: UploadClaim,
): Promise<ReservationRefusal | null> {
  await db.uploadReservation.create({
    data: {
      id: claim.id,
      ownerId: claim.ownerId,
      bytes: claim.bytes,
      shareId: claim.share?.id ?? null,
    },
  });

  const refusal = await reservationRefusal(claim);

  if (refusal) await releaseUpload(claim.id);

  return refusal;
}

async function reservationRefusal(
  claim: UploadClaim,
): Promise<ReservationRefusal | null> {
  const { share } = claim;

  if (share && share.maxUploadFiles !== null) {
    const [items, inFlight] = await Promise.all([
      db.shareItem.count({ where: { shareId: share.id } }),
      db.uploadReservation.count({
        where: { shareId: share.id, id: { not: claim.id } },
      }),
    ]);

    if (items + inFlight >= share.maxUploadFiles) {
      return { reason: "LINK_FULL" };
    }
  }

  return checkQuota(claim.ownerId, claim.bytes, { except: claim.id });
}

/** Drop an upload's reservation: it became a file, was cancelled, or failed. */
export async function releaseUpload(id: string): Promise<void> {
  await db.uploadReservation.deleteMany({ where: { id } });
}

/**
 * Reservations for uploads that can no longer finish. tus refuses to resume
 * an upload past `expiryMs` from its creation, so one older than that (with an
 * hour's grace for a body still arriving at the deadline) holds space for
 * nothing. Run by the hourly sweep, beside the one that removes the bytes.
 */
export async function pruneReservations(expiryMs: number): Promise<number> {
  const { count } = await db.uploadReservation.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - expiryMs - HOUR_MS) } },
  });

  return count;
}

const HOUR_MS = 60 * 60 * 1000;
