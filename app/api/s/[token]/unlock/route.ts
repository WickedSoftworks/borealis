import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/request";
import { unlockCookieName } from "@/lib/shares/guard";
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

  if (!(await verifySharePassword(parsed.data.password, share.passwordHash))) {
    await db.shareAccess.create({
      data: {
        shareId: share.id,
        action: "UNLOCK_FAIL",
        ipAddress: clientIp(req),
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
