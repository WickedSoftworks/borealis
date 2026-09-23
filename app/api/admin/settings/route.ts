import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { recordAudit } from "@/lib/audit";
import { isSecretSetting, writeSettings } from "@/lib/settings";
import { settingsSnapshot } from "@/lib/settings-snapshot";
import { validateSettingsPatch } from "@/lib/settings-validate";

export const runtime = "nodejs";

export async function GET() {
  const { denied } = await requireAdmin();
  if (denied) return denied;

  return NextResponse.json({ settings: await settingsSnapshot() });
}

/**
 * Change settings. Each key is validated on its own terms and a failure names
 * its field; a key sent as null goes back to the environment's value.
 */
export async function PATCH(req: Request) {
  const { session, denied } = await requireAdmin();
  if (denied) return denied;

  const result = validateSettingsPatch(await req.json().catch(() => null));

  if (!result.ok) {
    return NextResponse.json(
      { error: "Some settings are not valid.", fields: result.errors },
      { status: 400 },
    );
  }

  const changed = await writeSettings(result.patch);

  if (changed.length > 0) {
    await recordAudit({
      action: "SETTING_CHANGE",
      actor: { id: session.user.id, email: session.user.email },
      targetType: "setting",
      targetLabel: changed.join(", "),
      // The new values, except secrets — the log must not become a place a
      // password can be read from.
      detail: Object.fromEntries(
        changed.map((key) => [
          key,
          isSecretSetting(key)
            ? result.patch[key] === null
              ? "(reset)"
              : "(changed)"
            : (result.patch[key] ?? "(reset to environment)"),
        ]),
      ),
      request: req,
    });
  }

  return NextResponse.json({
    ok: true,
    changed,
    settings: await settingsSnapshot(),
  });
}
