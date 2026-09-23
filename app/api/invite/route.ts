import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  hashInviteCode,
  INVITE_COOKIE,
  INVITE_COOKIE_TTL_S,
} from "@/lib/invites";
import { hit, RULES, tooManyRequests } from "@/lib/rate-limit";
import { rateLimitAddress } from "@/lib/request";

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
  // Codes carry 160 bits, so guessing one is hopeless — but an endpoint that
  // answers "valid or not" as fast as it is asked is still an oracle worth
  // closing, and it is also the first step of every sign-up.
  const limit = await hit(
    `invite:${rateLimitAddress(req)}`,
    RULES.invitePerAddress,
  );

  if (!limit.allowed) {
    return tooManyRequests(
      limit.retryAfterSeconds,
      "Too many codes tried. Wait a few minutes and try again.",
    );
  }

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
