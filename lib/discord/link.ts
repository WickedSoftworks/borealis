import { createHash, randomBytes } from "node:crypto";
import { appUrl } from "@/lib/appUrl";
import { db } from "@/lib/db";

/** How long a /connect code works. Long enough to sign in, no longer. */
export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

export const CONNECT_PATH = "/dashboard/connect/discord";

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export type LinkedUser = { id: string; email: string; name: string };

/**
 * The Borealis account a Discord user may act for, or null.
 *
 * A confirmed link first. Failing that, an account that signs in with this
 * same Discord identity: better-auth stored Discord's user id as the
 * account id when they connected it, which proves ownership as well as a
 * link would. A banned account acts for nobody.
 */
export async function linkedUser(
  discordUserId: string,
): Promise<LinkedUser | null> {
  const link = await db.discordLink.findUnique({
    where: { discordUserId },
    select: {
      linkedAt: true,
      user: { select: { id: true, email: true, name: true, banned: true } },
    },
  });

  let user = link?.linkedAt ? link.user : null;

  if (!user) {
    const account = await db.account.findFirst({
      where: { providerId: "discord", accountId: discordUserId },
      select: {
        user: { select: { id: true, email: true, name: true, banned: true } },
      },
    });
    user = account?.user ?? null;
  }

  if (!user || user.banned) return null;

  return { id: user.id, email: user.email, name: user.name };
}

/**
 * Start linking: a one-time URL that, opened by someone signed in to
 * Borealis, ties this Discord user to their account.
 *
 * The Discord id comes from a signed interaction, so the only thing left to
 * prove is the Borealis side — which signing in and pressing Connect does.
 * Only the code's hash is stored. Asking again replaces the previous code.
 */
export async function issueLinkCode(
  discordUserId: string,
  discordName: string,
): Promise<{ url: string; expiresAt: Date }> {
  const code = randomBytes(18).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);

  await db.discordLink.upsert({
    where: { discordUserId },
    create: {
      discordUserId,
      discordName,
      codeHash: hashCode(code),
      codeExpiresAt: expiresAt,
    },
    update: {
      discordName,
      codeHash: hashCode(code),
      codeExpiresAt: expiresAt,
    },
  });

  return { url: `${appUrl()}${CONNECT_PATH}?code=${code}`, expiresAt };
}

/** The pending link a code belongs to, if it is still good. */
export async function pendingLink(code: string) {
  const link = await db.discordLink.findUnique({
    where: { codeHash: hashCode(code) },
    select: {
      id: true,
      discordName: true,
      codeExpiresAt: true,
      userId: true,
    },
  });

  if (!link?.codeExpiresAt || link.codeExpiresAt.getTime() < Date.now()) {
    return null;
  }

  return link;
}

/**
 * Finish linking. Single use: the code is cleared in the same update that
 * sets the owner, and the update only matches while the code is unexpired.
 */
export async function confirmLink(
  code: string,
  userId: string,
): Promise<boolean> {
  const result = await db.discordLink.updateMany({
    where: { codeHash: hashCode(code), codeExpiresAt: { gt: new Date() } },
    data: {
      userId,
      linkedAt: new Date(),
      codeHash: null,
      codeExpiresAt: null,
    },
  });

  return result.count > 0;
}

/** Remove a Discord user's link, from the Discord side. */
export async function unlinkDiscordUser(discordUserId: string) {
  const result = await db.discordLink.deleteMany({ where: { discordUserId } });
  return result.count > 0;
}

/** Remove one of an account's links, from the Borealis side. */
export async function unlinkForUser(userId: string, linkId: string) {
  const result = await db.discordLink.deleteMany({
    where: { id: linkId, userId },
  });
  return result.count > 0;
}
