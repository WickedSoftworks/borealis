import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { hit, RULES, tooManyRequests } from "@/lib/rate-limit";
import { clientIp, parseCidrList, rateLimitAddress } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { addressAllowed, unlockCookieName } from "@/lib/shares/guard";
import {
  describeWait,
  LOCKOUT_WINDOW_MS,
  unlockLockout,
} from "@/lib/shares/lockout";
import {
  signUnlockToken,
  UNLOCK_TTL_MS,
  verifySharePassword,
} from "@/lib/shares/password";

export const runtime = "nodejs";

const schema = z.object({ password: z.string().min(1).max(400) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Password is required" },
      { status: 400 },
    );
  }

  // Per address, across every share: slows a scan of many links from one
  // client. Forgeable on an instance that trusts no proxy, which is why the
  // per-share lockout below — which is not — carries the real weight.
  const perAddress = await hit(
    `unlock:${rateLimitAddress(req)}`,
    RULES.unlockPerAddress,
  );

  if (!perAddress.allowed) {
    return tooManyRequests(perAddress.retryAfterSeconds);
  }

  const share = await db.share.findUnique({ where: { token } });

  // Uniform response whether the share is missing, revoked, expired, or the
  // password is wrong — otherwise this endpoint enumerates valid tokens.
  const deny = () =>
    NextResponse.json({ error: "Incorrect password" }, { status: 401 });

  if (!share || share.revokedAt || !share.passwordHash) {
    return deny();
  }

  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
    return deny();
  }

  const address = clientIp(req);
  const { deniedIps } = await getSettings();

  // The same allow list the guard applies to the page, checked before any
  // password is: a caller on the wrong network gets no guesses at all.
  if (
    !addressAllowed(share.allowedIps, address, parseCidrList(deniedIps).ranges)
  ) {
    return deny();
  }

  /*
    The lockout is a property of the link. It answers before scrypt runs, so a
    locked share costs no CPU to hammer, and attempts made while locked are not
    recorded as failures — they were never checked, and counting them would
    let an attacker extend the lock indefinitely without ever guessing.

    A 429 here does reveal that the token names a real, password-protected
    share. That is acceptable: tokens carry 128 bits, so only someone who
    already holds the link can reach this branch.
  */
  const recent = await db.shareAccess.findMany({
    where: {
      shareId: share.id,
      action: "UNLOCK_FAIL",
      createdAt: { gt: new Date(Date.now() - LOCKOUT_WINDOW_MS) },
    },
    select: { createdAt: true },
  });

  const lockout = unlockLockout(recent.map((row) => row.createdAt));

  if (lockout.locked) {
    const retryAfter = Math.ceil(lockout.retryAfterMs / 1000);

    log.warn("share.unlock_locked", {
      shareId: share.id,
      failures: recent.length,
      retryAfter,
    });

    return tooManyRequests(
      retryAfter,
      `Too many wrong passwords for this link. Try again in ${describeWait(lockout.retryAfterMs)}.`,
    );
  }

  if (!(await verifySharePassword(parsed.data.password, share.passwordHash))) {
    await db.shareAccess.create({
      data: {
        shareId: share.id,
        action: "UNLOCK_FAIL",
        ipAddress: address,
        userAgent: req.headers.get("user-agent"),
      },
    });

    return deny();
  }

  const expiresAt = Date.now() + UNLOCK_TTL_MS;
  const unlockToken = signUnlockToken(share.id, share.passwordHash, expiresAt);

  const response = NextResponse.json({ ok: true });

  response.cookies.set(unlockCookieName(share.id), unlockToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(UNLOCK_TTL_MS / 1000),
  });

  return response;
}
