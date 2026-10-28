import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmLink } from "@/lib/discord/link";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const schema = z.object({ code: z.string().min(1).max(200) });

/**
 * Confirm a Discord link: the signed-in account takes the Discord user that
 * ran `/connect` and received this code. Single use.
 */
export async function POST(request: Request) {
  const session = await getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!(await confirmLink(parsed.data.code, session.user.id))) {
    return NextResponse.json(
      {
        error:
          "This link has expired or was already used. Run /connect in Discord again.",
      },
      { status: 410 },
    );
  }

  return NextResponse.json({ ok: true });
}
