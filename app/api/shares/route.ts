import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { allowedIpsSchema } from "@/lib/shares/allowlist";
import {
  type CreatedShare,
  createCollectionShare,
  createSendShare,
  ShareInputError,
} from "@/lib/shares/create";
import type { ExpiryInput } from "@/lib/shares/expiry";
import { expirySchema } from "@/lib/shares/expiry-schema";

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

/** The created link as the client expects it, or the refusal as JSON. */
async function respond(create: () => Promise<CreatedShare>) {
  try {
    const share = await create();

    return NextResponse.json(
      {
        id: share.id,
        token: share.token,
        url: share.url,
        expiresAt: share.expiresAt,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ShareInputError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    throw error;
  }
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

    const reverseInput = reverse.data;

    return respond(() =>
      createCollectionShare(session.user.id, {
        ...reverseInput,
        expiry: reverseInput.expiry as ExpiryInput,
      }),
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

  return respond(() =>
    createSendShare(session.user.id, {
      ...input,
      expiry: input.expiry as ExpiryInput,
    }),
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
