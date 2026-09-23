import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { allowedIpsSchema } from "@/lib/shares/allowlist";
import { type ExpiryInput, resolveExpiry } from "@/lib/shares/expiry";
import { expirySchema } from "@/lib/shares/expiry-schema";
import { hashSharePassword } from "@/lib/shares/password";

export const runtime = "nodejs";

/** A reverse share collects files; it starts empty and has no fileIds. */
const createReverseSchema = z.object({
  type: z.literal("REVERSE"),
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  expiry: expirySchema.default({ mode: "preset", preset: "1w" }),
  maxUploadFiles: z.number().int().positive().nullable().default(20),
  maxUploadMb: z.number().int().positive().nullable().default(null),
  requireUploader: z.boolean().default(true),
  allowedIps: allowedIpsSchema.default(null),
});

const createShareSchema = z
  .object({
    fileIds: z.array(z.string()).default([]),
    /**
     * Folders are shared LIVE: the link resolves the folder's contents on every
     * visit, so files added to it later are part of the share from that moment.
     * See lib/shares/contents.ts.
     */
    folderIds: z.array(z.string()).default([]),
    name: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    password: z.string().min(1).max(400).optional(),
    expiry: expirySchema.default({ mode: "preset", preset: "1w" }),
    maxDownloads: z.number().int().positive().nullable().default(null),
    egressLimitBytes: z.number().int().positive().nullable().default(null),
    viewOnly: z.boolean().default(false),
    isE2E: z.boolean().default(false),
    notifyOnDownload: z.boolean().default(false),
    notifyEmail: z.email().nullable().default(null),
    allowedIps: allowedIpsSchema.default(null),
  })
  // A share of nothing is not a share. Enforced across both lists rather than
  // with .min(1) on either, since a folder-only share is perfectly ordinary.
  .refine((body) => body.fileIds.length + body.folderIds.length > 0, {
    message: "Select at least one file or folder",
  });

/** 22 chars of base64url ≈ 132 bits — not guessable, still copy-pasteable. */
function generateShareToken() {
  return randomBytes(16).toString("base64url");
}

export async function POST(req: Request) {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await req.json().catch(() => null);

  // Reverse shares take a different shape entirely — they collect rather than
  // serve, so they have no files at creation and no download limits.
  if (payload?.type === "REVERSE") {
    const reverse = createReverseSchema.safeParse(payload);

    if (!reverse.success) {
      return NextResponse.json(
        {
          error:
            reverse.error.issues.find((issue) => issue.path[0] === "allowedIps")
              ?.message ?? "Invalid request",
        },
        { status: 400 },
      );
    }

    let reverseExpiry: Date | null;

    try {
      reverseExpiry = resolveExpiry(reverse.data.expiry as ExpiryInput);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid expiry" },
        { status: 400 },
      );
    }

    const created = await db.share.create({
      data: {
        token: generateShareToken(),
        type: "REVERSE",
        name: reverse.data.name,
        description: reverse.data.description,
        expiresAt: reverseExpiry,
        maxUploadFiles: reverse.data.maxUploadFiles,
        maxUploadBytes:
          reverse.data.maxUploadMb === null
            ? null
            : BigInt(reverse.data.maxUploadMb * 1024 * 1024),
        requireUploader: reverse.data.requireUploader,
        allowedIps: reverse.data.allowedIps,
        ownerId: session.user.id,
      },
      select: { id: true, token: true, expiresAt: true },
    });

    return NextResponse.json(
      {
        id: created.id,
        token: created.token,
        url: `/r/${created.token}`,
        expiresAt: created.expiresAt,
      },
      { status: 201 },
    );
  }

  const parsed = createShareSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues.find((issue) => issue.path[0] === "allowedIps")
            ?.message ?? "Invalid request",
        issues: z.treeifyError(parsed.error),
      },
      { status: 400 },
    );
  }

  const input = parsed.data;

  // Only files and folders the caller actually owns can be shared.
  const files = await db.file.findMany({
    where: {
      id: { in: input.fileIds },
      ownerId: session.user.id,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (files.length !== input.fileIds.length) {
    return NextResponse.json(
      { error: "One or more files were not found" },
      { status: 404 },
    );
  }

  const folders = await db.folder.findMany({
    where: {
      id: { in: input.folderIds },
      ownerId: session.user.id,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (folders.length !== input.folderIds.length) {
    return NextResponse.json(
      { error: "One or more folders were not found" },
      { status: 404 },
    );
  }

  let expiresAt: Date | null;

  try {
    expiresAt = resolveExpiry(input.expiry as ExpiryInput);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid expiry" },
      { status: 400 },
    );
  }

  const share = await db.share.create({
    data: {
      token: generateShareToken(),
      type: "SEND",
      name: input.name,
      description: input.description,
      passwordHash: input.password
        ? await hashSharePassword(input.password)
        : null,
      expiresAt,
      maxDownloads: input.maxDownloads,
      egressLimitBytes:
        input.egressLimitBytes === null ? null : BigInt(input.egressLimitBytes),
      viewOnly: input.viewOnly,
      isE2E: input.isE2E,
      notifyOnDownload: input.notifyOnDownload,
      notifyEmail: input.notifyEmail,
      allowedIps: input.allowedIps,
      ownerId: session.user.id,
      items: {
        create: [
          ...files.map((file) => ({ fileId: file.id })),
          ...folders.map((folder) => ({ folderId: folder.id })),
        ],
      },
    },
    select: { id: true, token: true, expiresAt: true },
  });

  return NextResponse.json(
    {
      id: share.id,
      token: share.token,
      url: `/s/${share.token}`,
      expiresAt: share.expiresAt,
    },
    { status: 201 },
  );
}

export async function GET() {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shares = await db.share.findMany({
    where: { ownerId: session.user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      token: true,
      name: true,
      expiresAt: true,
      maxDownloads: true,
      downloadCount: true,
      egressLimitBytes: true,
      egressUsedBytes: true,
      viewOnly: true,
      isE2E: true,
      passwordHash: true,
      createdAt: true,
      _count: { select: { items: true } },
    },
  });

  return NextResponse.json({
    shares: shares.map(
      ({ passwordHash, egressLimitBytes, egressUsedBytes, ...share }) => ({
        ...share,
        // Never leak the hash itself — only whether a gate exists.
        hasPassword: passwordHash !== null,
        egressLimitBytes:
          egressLimitBytes === null ? null : Number(egressLimitBytes),
        egressUsedBytes: Number(egressUsedBytes),
        fileCount: share._count.items,
      }),
    ),
  });
}
