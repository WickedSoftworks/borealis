import { parseByteSize } from "@/lib/bytes";
import { parseCidrList } from "@/lib/request";
import { SETTING_KEYS, type SettingKey } from "@/lib/settings";

/**
 * Validation for the admin settings form.
 *
 * Each key is checked on its own terms and a failure names the field, so the
 * panel can mark the one input that is wrong instead of refusing the whole
 * form with "invalid request". A value that fails here never reaches the
 * table, which is what lets lib/settings.ts read rows without distrust.
 *
 * `null` always passes: it means "reset to the environment".
 */

export type SettingsPatch = Partial<Record<SettingKey, string | null>>;

const NO_CEILING = /^\s*(unlimited|none)?\s*$/i;

function sizeOrUnlimited(value: string): string | null {
  if (NO_CEILING.test(value)) return null;
  return parseByteSize(value) === null
    ? `"${value}" is not a size. Try "50GB", "512MB", or "unlimited".`
    : null;
}

const CHECKS: Record<SettingKey, (value: string) => string | null> = {
  "instance.name": (value) =>
    value.trim().length === 0
      ? "A name is required."
      : value.trim().length > 60
        ? "Keep it to 60 characters."
        : null,
  "storage.defaultQuota": sizeOrUnlimited,
  "storage.ceiling": sizeOrUnlimited,
  "uploads.maxFileSize": sizeOrUnlimited,
  "audit.retentionDays": (value) => {
    const days = Number(value);
    return Number.isFinite(days) && days >= 1 && days <= 3650
      ? null
      : "Between 1 and 3650 days.";
  },
  "security.deniedIps": (value) => {
    const { invalid } = parseCidrList(value);
    return invalid.length > 0
      ? `Not an address or range: ${invalid.join(", ")}`
      : null;
  },
  "mail.host": (value) =>
    /^[a-z0-9.-]{1,253}$/i.test(value.trim()) ? null : "Not a hostname.",
  "mail.port": (value) => {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535
      ? null
      : "A port between 1 and 65535.";
  },
  "mail.user": (value) => (value.length <= 320 ? null : "Too long."),
  "mail.password": (value) => (value.length <= 1024 ? null : "Too long."),
  "mail.from": (value) =>
    /^([^<>]*<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(value.trim())
      ? null
      : 'An address, or "Name <address>".',
  "mail.secure": (value) =>
    value === "true" || value === "false" ? null : 'Either "true" or "false".',
};

export function validateSettingsPatch(
  input: unknown,
):
  | { ok: true; patch: SettingsPatch }
  | { ok: false; errors: Partial<Record<string, string>> } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: { form: "Expected an object of settings." } };
  }

  const patch: SettingsPatch = {};
  const errors: Partial<Record<string, string>> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!SETTING_KEYS.includes(key as SettingKey)) {
      errors[key] = "Unknown setting.";
      continue;
    }

    if (value === null) {
      patch[key as SettingKey] = null;
      continue;
    }

    if (typeof value !== "string") {
      errors[key] = "Expected text.";
      continue;
    }

    const problem = CHECKS[key as SettingKey](value);

    if (problem) errors[key] = problem;
    else patch[key as SettingKey] = value.trim();
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, patch };
}
