import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { type ExpiryInput, resolveExpiry } from "@/lib/shares/expiry";
import { hashSharePassword } from "@/lib/shares/password";

/**
 * Making links, for every surface that makes them: the share routes and the
 * Discord commands. Input is assumed already shaped (the routes validate with
 * zod, the bot builds it from typed options); ownership and expiry are checked
 * here, because those rules must hold whoever is asking.
 */

/** A refusal the caller should show as it is, with the status it implies. */
export class ShareInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
  }
}

export type CreatedShare = {
  id: string;
  token: string;
  /** Path on this instance, e.g. "/s/abc"; the caller adds the origin. */
  url: string;
  expiresAt: Date | null;
};

export type SendShareInput = {
  fileIds: string[];
  folderIds: string[];
  name?: string;
  description?: string;
  password?: string;
  expiry: ExpiryInput;
  maxDownloads: number | null;
  egressLimitBytes: number | null;
  viewOnly: boolean;
  isE2E: boolean;
  notifyOnDownload: boolean;
  notifyEmail: string | null;
  allowedIps: string | null;
};

export type CollectionShareInput = {
  name?: string;
  description?: string;
  expiry: ExpiryInput;
  maxUploadFiles: number | null;
  maxUploadMb: number | null;
  requireUploader: boolean;
  allowedIps: string | null;
};

/** 22 chars of base64url ≈ 132 bits — not guessable, still copy-pasteable. */
function generateShareToken() {
  return randomBytes(16).toString("base64url");
}

function expiryOf(input: ExpiryInput): Date | null {
  try {
    return resolveExpiry(input);
  } catch (error) {
    throw new ShareInputError(
      error instanceof Error ? error.message : "Invalid expiry",
      400,
    );
  }
}

/** A link that serves files out. Only files and folders the owner has. */
export async function createSendShare(
  ownerId: string,
  input: SendShareInput,
): Promise<CreatedShare> {
  if (input.fileIds.length + input.folderIds.length === 0) {
    throw new ShareInputError("Select at least one file or folder", 400);
  }

  const files = await db.file.findMany({
    where: { id: { in: input.fileIds }, ownerId, deletedAt: null },
    select: { id: true },
  });

  if (files.length !== input.fileIds.length) {
    throw new ShareInputError("One or more files were not found", 404);
  }

  const folders = await db.folder.findMany({
    where: { id: { in: input.folderIds }, ownerId, deletedAt: null },
    select: { id: true },
  });

  if (folders.length !== input.folderIds.length) {
    throw new ShareInputError("One or more folders were not found", 404);
  }

  const expiresAt = expiryOf(input.expiry);

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
      ownerId,
      items: {
        create: [
          ...files.map((file) => ({ fileId: file.id })),
          ...folders.map((folder) => ({ folderId: folder.id })),
        ],
      },
    },
    select: { id: true, token: true, expiresAt: true },
  });

  return { ...share, url: `/s/${share.token}` };
}

/** A link that collects files into the owner's vault. Starts empty. */
export async function createCollectionShare(
  ownerId: string,
  input: CollectionShareInput,
): Promise<CreatedShare> {
  const expiresAt = expiryOf(input.expiry);

  const share = await db.share.create({
    data: {
      token: generateShareToken(),
      type: "REVERSE",
      name: input.name,
      description: input.description,
      expiresAt,
      maxUploadFiles: input.maxUploadFiles,
      maxUploadBytes:
        input.maxUploadMb === null
          ? null
          : BigInt(input.maxUploadMb * 1024 * 1024),
      requireUploader: input.requireUploader,
      allowedIps: input.allowedIps,
      ownerId,
    },
    select: { id: true, token: true, expiresAt: true },
  });

  return { ...share, url: `/r/${share.token}` };
}

/** Stop a link working, for everyone, now. False if it was not live or not theirs. */
export async function revokeShare(
  ownerId: string,
  shareId: string,
): Promise<boolean> {
  const result = await db.share.updateMany({
    where: { id: shareId, ownerId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return result.count > 0;
}
