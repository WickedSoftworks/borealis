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
 * One race is accepted rather than engineered away: two uploads started at
 * the same moment are each checked against usage that excludes the other.
 * Closing it would mean reserving space for in-flight uploads, which then
 * needs its own expiry and cleanup, to prevent an overshoot bounded by one
 * file.
 */

export type Usage = {
  /** Live files plus trash, in bytes. */
  used: bigint;
  trash: bigint;
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

  if (account.limit !== null && account.used + size > account.limit) {
    const left =
      account.limit > account.used ? account.limit - account.used : 0n;
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
  const [user, all, trash, settings] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { storageQuotaBytes: true },
    }),
    db.file.aggregate({ where: { ownerId: userId }, _sum: { size: true } }),
    db.file.aggregate({
      where: { ownerId: userId, deletedAt: { not: null } },
      _sum: { size: true },
    }),
    getSettings(),
  ]);

  return {
    used: all._sum.size ?? 0n,
    trash: trash._sum.size ?? 0n,
    limit: user?.storageQuotaBytes ?? settings.defaultQuotaBytes,
  };
}

export async function instanceUsage(): Promise<bigint> {
  const total = await db.file.aggregate({ _sum: { size: true } });
  return total._sum.size ?? 0n;
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
): Promise<QuotaRefusal | null> {
  const settings = await getSettings();

  const [account, instanceUsed] = await Promise.all([
    accountUsage(userId),
    settings.storageCeilingBytes === null
      ? Promise.resolve(0n)
      : instanceUsage(),
  ]);

  return quotaVerdict({
    size,
    account,
    instanceUsed,
    instanceCeiling: settings.storageCeilingBytes,
    maxUpload: settings.maxUploadBytes,
  });
}
