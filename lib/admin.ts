import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/invites";
import { getSession } from "@/lib/session";

/**
 * The session of an admin or root, or the response to send instead.
 *
 * For the instance-level admin routes — settings, jobs, storage, the audit
 * log — which have no per-target peer rule the way account actions do: any
 * admin may read and change instance configuration. That is a deliberate
 * choice, stated here because it is the one place admins are not peers.
 */
export async function requireAdmin() {
  const session = await getSession();

  if (!session?.user || !isAdmin(session.user.role)) {
    return {
      session: null,
      denied: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    } as const;
  }

  return { session, denied: null } as const;
}
