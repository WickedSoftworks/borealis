import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { diffShareItems } from "@/lib/shares/edit";
import { type ExpiryInput, resolveExpiry } from "@/lib/shares/expiry";
import { expirySchema } from "@/lib/shares/expiry-schema";
import { hashSharePassword } from "@/lib/shares/password";

export const runtime = "nodejs";

/** Everything the edit dialog needs, and nothing the recipient side cares about. */
const DETAIL_SELECT = {
  id: true,
  token: true,
  type: true,
  name: true,
  description: true,
  passwordHash: true,
  expiresAt: true,
  maxDownloads: true,
  downloadCount: true,
  egressLimitBytes: true,
  egressUsedBytes: true,
  viewOnly: true,
  isE2E: true,
  notifyOnDownload: true,
  notifyEmail: true,
  items: { select: { fileId: true, folderId: true } },
} as const;

type DetailRow = {
  id: string;
  token: string;
  type: string;
  name: string | null;
  description: string | null;
  passwordHash: string | null;
  expiresAt: Date | null;
  maxDownloads: number | null;
  downloadCount: number;
  egressLimitBytes: bigint | null;
  egressUsedBytes: bigint;
  viewOnly: boolean;
  isE2E: boolean;
  notifyOnDownload: boolean;
  notifyEmail: string | null;
  items: Array<{ fileId: string | null; folderId: string | null }>;
};

/**
 * The share as its own owner sees it.
 *
 * Two things this must keep doing: never emit `passwordHash` — only whether a
 * gate exists — and coerce both BigInt egress columns, which JSON cannot encode.
 */
function shareDetail(share: DetailRow) {
  return {
    id: share.id,
    token: share.token,
    kind: share.type === "REVERSE" ? ("REVERSE" as const) : ("SEND" as const),
    url: `${share.type === "REVERSE" ? "/r/" : "/s/"}${share.token}`,
    name: share.name,
    description: share.description,
    hasPassword: share.passwordHash !== null,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    maxDownloads: share.maxDownloads,
    downloadCount: share.downloadCount,
    egressLimitBytes:
      share.egressLimitBytes === null ? null : Number(share.egressLimitBytes),
    egressUsedBytes: Number(share.egressUsedBytes),
    viewOnly: share.viewOnly,
    isE2E: share.isE2E,
    notifyOnDownload: share.notifyOnDownload,
    notifyEmail: share.notifyEmail,
    fileIds: share.items.flatMap((item) => (item.fileId ? [item.fileId] : [])),
    folderIds: share.items.flatMap((item) =>
      item.folderId ? [item.folderId] : [],
    ),
  };
}

/**
 * One share in full, for the edit dialog to prefill from.
 *
 * Separate from the dashboard's own query so that the description, the notify
 * fields, and the item ids are fetched by the one screen that wants them rather
 * than added to every dashboard render for every user.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const share = await db.share.findFirst({
    where: { id, ownerId: session.user.id, revokedAt: null },
    select: DETAIL_SELECT,
  });

  if (!share) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ share: shareDetail(share) });
}

/**
 * Revoke a share. Soft — the row stays so its access log stays readable, but
 * the guard refuses it from the next request onward.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db.share.updateMany({
    where: { id, ownerId: session.user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * Edit a live share.
 *
 * Absent means "leave it alone" and null means "clear it" — the same
 * distinction `app/api/folders/[id]/route.ts` draws, and the reason every field
 * here is optional rather than defaulted the way creation's are.
 *
 * Rotating the password needs no cookie-clearing code: the unlock token is an
 * HMAC over the current hash (lib/shares/password.ts), so writing a new hash
 * invalidates every outstanding grant by itself. Removing the password drops
 * the gate entirely, which the guard already handles.
 */
const patchSchema = z
  .object({
    name: z.string().max(200).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    /** Absent keeps the current gate, a string rotates it, null removes it. */
    password: z.string().min(1).max(400).nullable().optional(),
    expiry: expirySchema.optional(),
    maxDownloads: z.number().int().positive().nullable().optional(),
    egressLimitBytes: z.number().int().positive().nullable().optional(),
    viewOnly: z.boolean().optional(),
    notifyOnDownload: z.boolean().optional(),
    notifyEmail: z.email().nullable().optional(),
    /** Present replaces that kind wholesale; absent leaves it untouched. */
    fileIds: z.array(z.string()).optional(),
    folderIds: z.array(z.string()).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Nothing to change",
  });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const input = parsed.data;

  // Revoked shares are excluded here, not merely hidden: revoking is a one-way
  // door, and an edit able to reopen one would quietly undo the only action in
  // the product whose whole value is that it cannot be taken back.
  const share = await db.share.findFirst({
    where: { id, ownerId: session.user.id, revokedAt: null },
    select: DETAIL_SELECT,
  });

  if (!share) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (share.type === "REVERSE") {
    return NextResponse.json(
      {
        error:
          "This is a collection link. Its upload settings are not edited here.",
      },
      { status: 400 },
    );
  }

  const current = shareDetail(share);
  const diff = diffShareItems(
    { fileIds: current.fileIds, folderIds: current.folderIds },
    { fileIds: input.fileIds, folderIds: input.folderIds },
  );

  // A share of nothing is not a share — the same rule creation enforces, but it
  // has to be re-checked here because an edit can arrive at an empty set from
  // either direction.
  if (diff.resulting.fileIds.length + diff.resulting.folderIds.length === 0) {
    return NextResponse.json(
      { error: "A link must carry at least one file or folder." },
      { status: 400 },
    );
  }

  // Only items the caller actually owns can be added. Checked on the additions
  // rather than the whole set, so an item that has since been trashed does not
  // block an unrelated edit to the same link.
  if (diff.addFileIds.length > 0) {
    const owned = await db.file.count({
      where: {
        id: { in: diff.addFileIds },
        ownerId: session.user.id,
        deletedAt: null,
      },
    });

    if (owned !== diff.addFileIds.length) {
      return NextResponse.json(
        { error: "One or more files were not found" },
        { status: 404 },
      );
    }
  }

  if (diff.addFolderIds.length > 0) {
    const owned = await db.folder.count({
      where: {
        id: { in: diff.addFolderIds },
        ownerId: session.user.id,
        deletedAt: null,
      },
    });

    if (owned !== diff.addFolderIds.length) {
      return NextResponse.json(
        { error: "One or more folders were not found" },
        { status: 404 },
      );
    }
  }

  let expiresAt: Date | null | undefined;

  if (input.expiry !== undefined) {
    try {
      expiresAt = resolveExpiry(input.expiry as ExpiryInput);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid expiry" },
        { status: 400 },
      );
    }
  }

  const passwordHash =
    input.password === undefined
      ? undefined
      : input.password === null
        ? null
        : await hashSharePassword(input.password);

  const updated = await db.$transaction(async (tx) => {
    // Owner-scoped in the write itself, not only in the read above, so there is
    // no window for the row to change hands or be revoked in between.
    const result = await tx.share.updateMany({
      where: { id: share.id, ownerId: session.user.id, revokedAt: null },
      data: {
        // Always present, for two reasons: changing only the item set leaves
        // every other key absent, and Prisma reports an empty `data` as zero
        // rows affected — which would read here as "the share is gone". It is
        // also simply true, since re-choosing what a link carries is an edit.
        updatedAt: new Date(),
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(passwordHash !== undefined && { passwordHash }),
        ...(expiresAt !== undefined && { expiresAt }),
        ...(input.maxDownloads !== undefined && {
          maxDownloads: input.maxDownloads,
        }),
        ...(input.egressLimitBytes !== undefined && {
          egressLimitBytes:
            input.egressLimitBytes === null
              ? null
              : BigInt(input.egressLimitBytes),
        }),
        ...(input.viewOnly !== undefined && { viewOnly: input.viewOnly }),
        ...(input.notifyOnDownload !== undefined && {
          notifyOnDownload: input.notifyOnDownload,
        }),
        ...(input.notifyEmail !== undefined && {
          notifyEmail: input.notifyEmail,
        }),
      },
    });

    if (result.count === 0) return null;

    if (diff.removeFileIds.length > 0) {
      await tx.shareItem.deleteMany({
        where: { shareId: share.id, fileId: { in: diff.removeFileIds } },
      });
    }

    if (diff.removeFolderIds.length > 0) {
      await tx.shareItem.deleteMany({
        where: { shareId: share.id, folderId: { in: diff.removeFolderIds } },
      });
    }

    if (diff.addFileIds.length > 0 || diff.addFolderIds.length > 0) {
      await tx.shareItem.createMany({
        data: [
          ...diff.addFileIds.map((fileId) => ({ shareId: share.id, fileId })),
          ...diff.addFolderIds.map((folderId) => ({
            shareId: share.id,
            folderId,
          })),
        ],
      });
    }

    return tx.share.findFirst({
      where: { id: share.id, ownerId: session.user.id },
      select: DETAIL_SELECT,
    });
  });

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ share: shareDetail(updated) });
}
