import { db } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { uploadExpiryMs } from "@/lib/tus-store";

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
 * Incomplete tus uploads reserve their declared size in UploadReservation.
 * Serializable transactions make the account, instance, and reverse-share
 * checks one admission decision even across server processes.
 */

export type Usage = {
  /** Live files plus trash, in bytes. */
  used: bigint;
  trash: bigint;
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
  reason: "FILE_TOO_LARGE" | "ACCOUNT_FULL" | "INSTANCE_FULL" | "SHARE_FULL";
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

  const occupied = account.used + account.reserved;
  if (account.limit !== null && occupied + size > account.limit) {
    const left = account.limit > occupied ? account.limit - occupied : 0n;
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

/** An account's usage and effective limit. */
export async function accountUsage(userId: string): Promise<Usage> {
  const [user, all, trash, reservations, settings] = await Promise.all([
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
      where: { ownerId: userId },
      _sum: { bytes: true },
    }),
    getSettings(),
  ]);

  return {
    used: all._sum.size ?? 0n,
    trash: trash._sum.size ?? 0n,
    reserved: reservations._sum.bytes ?? 0n,
    limit: user?.storageQuotaBytes ?? settings.defaultQuotaBytes,
  };
}

export async function instanceUsage(): Promise<bigint> {
  const total = await db.file.aggregate({ _sum: { size: true } });
  return total._sum.size ?? 0n;
}

/** Claim bytes and an optional reverse-share slot before tus stores anything. */
export async function reserveUpload(
  id: string,
  ownerId: string,
  size: bigint,
  shareId?: string,
): Promise<QuotaRefusal | null> {
  const settings = await getSettings();

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const now = new Date();
          const user = await tx.user.findUnique({
            where: { id: ownerId },
            select: { storageQuotaBytes: true },
          });
          if (!user) {
            throw new Error("Upload owner no longer exists");
          }
          const files = await tx.file.aggregate({
            where: { ownerId },
            _sum: { size: true },
          });
          const trash = await tx.file.aggregate({
            where: { ownerId, deletedAt: { not: null } },
            _sum: { size: true },
          });
          const reserved = await tx.uploadReservation.aggregate({
            where: { ownerId },
            _sum: { bytes: true },
          });
          const instanceFiles =
            settings.storageCeilingBytes === null
              ? 0n
              : ((await tx.file.aggregate({ _sum: { size: true } }))._sum
                  .size ?? 0n);
          const instanceReserved =
            settings.storageCeilingBytes === null
              ? 0n
              : ((
                  await tx.uploadReservation.aggregate({
                    _sum: { bytes: true },
                  })
                )._sum.bytes ?? 0n);

          const refusal = quotaVerdict({
            size,
            account: {
              used: files._sum.size ?? 0n,
              reserved: reserved._sum.bytes ?? 0n,
              trash: trash._sum.size ?? 0n,
              limit: user.storageQuotaBytes ?? settings.defaultQuotaBytes,
            },
            instanceUsed: instanceFiles + instanceReserved,
            instanceCeiling: settings.storageCeilingBytes,
            maxUpload: settings.maxUploadBytes,
          });
          if (refusal) return refusal;

          if (shareId) {
            const share = await tx.share.findUnique({ where: { id: shareId } });
            if (
              !share ||
              share.type !== "REVERSE" ||
              share.ownerId !== ownerId ||
              share.revokedAt ||
              (share.expiresAt && share.expiresAt <= now) ||
              (share.maxUploadBytes !== null && size > share.maxUploadBytes)
            ) {
              return {
                reason: "SHARE_FULL",
                message: "This upload link is no longer accepting files.",
              };
            }
            if (share.maxUploadFiles !== null) {
              const completed = await tx.shareItem.count({
                where: { shareId },
              });
              const pending = await tx.uploadReservation.count({
                where: { shareId },
              });
              if (completed + pending >= share.maxUploadFiles) {
                return {
                  reason: "SHARE_FULL",
                  message: "This upload link has reached its file limit.",
                };
              }
            }
          }

          await tx.uploadReservation.create({
            data: {
              id,
              ownerId,
              shareId: shareId ?? null,
              bytes: size,
              expiresAt: new Date(now.getTime() + uploadExpiryMs()),
            },
          });
          return null;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if ((error as { code?: string }).code !== "P2034" || attempt === 3)
        throw error;
    }
  }
  throw new Error("Could not reserve upload capacity");
}
