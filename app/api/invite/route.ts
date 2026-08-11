import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  hashInviteCode,
  INVITE_COOKIE,
  INVITE_COOKIE_TTL_S,
} from "@/lib/invites";

export const runtime = "nodejs";

const schema = z.object({ code: z.string().min(1).max(200) });

/**
 * Claim an invitation code.
 *
 * Parks a validated code in a short-lived HTTP-only cookie so it survives the
 * redirect out to an OAuth provider and back. The authoritative check still
 * happens in the user-create hook — this endpoint only gives the visitor early,
 * honest feedback instead of letting them complete a whole GitHub round trip
 * before being told the code was wrong.
 *
 * The code is NOT consumed here; it is burned when an account is actually
 * created against it.
 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter an invitation code." },
      { status: 400 },
    );
  }

  const invite = await db.invite.findUnique({
    where: { codeHash: hashInviteCode(parsed.data.code) },
    select: {
      grantsRole: true,
      expiresAt: true,
      revokedAt: true,
      redeemedAt: true,
    },
  });

  const usable =
    invite &&
    !invite.revokedAt &&
    !invite.redeemedAt &&
    (!invite.expiresAt || invite.expiresAt.getTime() > Date.now());

  if (!usable) {
    // One message for every failure mode. Distinguishing "already used" from
    // "no such code" would let someone probe which codes exist.
    return NextResponse.json(
      { error: "That invitation code isn't valid." },
      { status: 403 },
    );
  }

  const response = NextResponse.json({
    ok: true,
    grantsRole: invite.grantsRole,
  });

  response.cookies.set(INVITE_COOKIE, parsed.data.code, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: INVITE_COOKIE_TTL_S,
  });

  return response;
}
