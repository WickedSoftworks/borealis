import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { type ExpiryInput, resolveExpiry } from "@/lib/shares/expiry";
import { hashSharePassword } from "@/lib/shares/password";

export const runtime = "nodejs";

const expirySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("preset"),
    preset: z.enum(["24h", "1w", "1m", "1y", "5y", "forever"]),
  }),
  z.object({
    mode: z.literal("duration"),
    value: z.number().positive(),
    unit: z.enum(["minutes", "hours", "days", "weeks"]),
  }),
  z.object({ mode: z.literal("until"), date: z.string() }),
]);

/** A reverse share collects files; it starts empty and has no fileIds. */
const createReverseSchema = z.object({
  type: z.literal("REVERSE"),
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  expiry: expirySchema.default({ mode: "preset", preset: "1w" }),
  maxUploadFiles: z.number().int().positive().nullable().default(20),
  maxUploadMb: z.number().int().positive().nullable().default(null),
  requireUploader: z.boolean().default(true),
});

const createShareSchema = z.object({
  fileIds: z.array(z.string()).min(1),
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
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
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
      { error: "Invalid request", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const input = parsed.data;

  // Only files the caller actually owns can be shared.
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
      ownerId: session.user.id,
      items: { create: files.map((file) => ({ fileId: file.id })) },
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
