import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness for the container healthcheck and any reverse proxy in front.
 *
 * Touches the database, because a process that is listening but cannot reach
 * its own storage is not healthy in any sense the operator cares about.
 * Deliberately returns nothing identifying — it is reachable without a session.
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
