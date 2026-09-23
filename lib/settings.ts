import { parseByteSize } from "@/lib/bytes";
import { db } from "@/lib/db";
import { open, seal } from "@/lib/secret-box";

/**
 * Runtime configuration, editable from the admin panel without a restart.
 *
 * Every setting has three possible sources, in order: a row in `AppSetting`,
 * the environment variable it has always been read from, and a built-in
 * default. An instance nobody has touched through the panel therefore behaves
 * exactly as its .env says — the panel adds a layer, it does not replace one —
 * and "reset" means deleting the row, which hands control back to the file.
 *
 * Deliberately NOT here: the database, the storage driver, the auth secret,
 * the public URL, and OAuth credentials. Each of those is either needed before
 * the database can be read, or is read once at boot by a library that cannot
 * be re-pointed while running. Offering them in a form that silently needs a
 * restart would be worse than leaving them in the file.
 *
 * Reads are cached for a few seconds, so a replica picks up another replica's
 * change within that window and a page render does not query this table once
 * per setting.
 */

export type MailSettings = {
  host: string | null;
  port: number;
  user: string | null;
  password: string | null;
  from: string | null;
  /** Null means "decide from the port": implicit TLS on 465, STARTTLS elsewhere. */
  secure: boolean | null;
};

export type Settings = {
  instanceName: string;
  /** Per-account ceiling for accounts without their own. Null = unlimited. */
  defaultQuotaBytes: bigint | null;
  /** Everything on the instance together. Null = only the disk. */
  storageCeilingBytes: bigint | null;
  /** Largest single upload. Null = no limit beyond the quotas. */
  maxUploadBytes: bigint | null;
  /** Days the share access log keeps a row. */
  auditRetentionDays: number;
  /** Comma-separated addresses and ranges refused on every public link. */
  deniedIps: string;
  mail: MailSettings;
};

export type SettingSource = "database" | "environment" | "default";

/** Every stored key, and the environment variable it falls back to. */
const DEFINITIONS = {
  "instance.name": "INSTANCE_NAME",
  "storage.defaultQuota": "DEFAULT_QUOTA",
  "storage.ceiling": "STORAGE_CEILING",
  "uploads.maxFileSize": "MAX_UPLOAD_SIZE",
  "audit.retentionDays": "AUDIT_RETENTION_DAYS",
  "security.deniedIps": "DENIED_IPS",
  "mail.host": "SMTP_HOST",
  "mail.port": "SMTP_PORT",
  "mail.user": "SMTP_USER",
  "mail.password": "SMTP_PASSWORD",
  "mail.from": "SMTP_FROM",
  "mail.secure": "SMTP_SECURE",
} as const;

/** Sealed with lib/secret-box.ts at rest, and never sent back to a browser. */
const SECRET_KEYS: ReadonlySet<string> = new Set(["mail.password"]);

export type SettingKey = keyof typeof DEFINITIONS;
export const SETTING_KEYS = Object.keys(DEFINITIONS) as SettingKey[];

export const DEFAULT_INSTANCE_NAME = "Borealis";
export const DEFAULT_AUDIT_RETENTION_DAYS = 30;

type Env = Record<string, string | undefined>;

export type ResolvedSettings = {
  values: Settings;
  sources: Record<SettingKey, SettingSource>;
  /** The string each value was read from, as the operator wrote it. */
  raw: Partial<Record<SettingKey, string>>;
};

function positiveNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function nonEmpty(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

/**
 * The pure half: database rows (already decoded to strings) plus the
 * environment in, typed settings and their provenance out.
 */
export function resolveSettings(
  rows: Partial<Record<SettingKey, string>>,
  env: Env,
): ResolvedSettings {
  const sources = {} as Record<SettingKey, SettingSource>;
  const used: Partial<Record<SettingKey, string>> = {};

  const raw = (key: SettingKey): string | undefined => {
    if (rows[key] !== undefined) {
      sources[key] = "database";
      used[key] = rows[key];
      return rows[key];
    }

    const fromEnv = env[DEFINITIONS[key]];

    if (fromEnv !== undefined && fromEnv.trim() !== "") {
      sources[key] = "environment";
      used[key] = fromEnv;
      return fromEnv;
    }

    sources[key] = "default";
    return undefined;
  };

  const secureRaw = raw("mail.secure")?.trim().toLowerCase();

  const values: Settings = {
    instanceName:
      nonEmpty(raw("instance.name"))?.slice(0, 60) ?? DEFAULT_INSTANCE_NAME,
    defaultQuotaBytes: parseByteSize(raw("storage.defaultQuota")),
    storageCeilingBytes: parseByteSize(raw("storage.ceiling")),
    maxUploadBytes: parseByteSize(raw("uploads.maxFileSize")),
    auditRetentionDays:
      positiveNumber(raw("audit.retentionDays")) ??
      DEFAULT_AUDIT_RETENTION_DAYS,
    deniedIps: raw("security.deniedIps")?.trim() ?? "",
    mail: {
      host: nonEmpty(raw("mail.host")),
      port: positiveNumber(raw("mail.port")) ?? 587,
      user: nonEmpty(raw("mail.user")),
      password: raw("mail.password") ?? null,
      from: nonEmpty(raw("mail.from")),
      secure:
        secureRaw === "true" ? true : secureRaw === "false" ? false : null,
    },
  };

  return { values, sources, raw: used };
}

// ----------------------------------------------------------------- Storage --

const TTL_MS = 5_000;
let cache: { at: number; resolved: ResolvedSettings } | null = null;

async function loadRows(): Promise<Partial<Record<SettingKey, string>>> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: SETTING_KEYS } },
  });

  const out: Partial<Record<SettingKey, string>> = {};

  for (const row of rows) {
    const key = row.key as SettingKey;

    try {
      const decoded = JSON.parse(row.value) as unknown;
      if (typeof decoded !== "string") continue;

      if (SECRET_KEYS.has(key)) {
        // Unreadable (the auth secret rotated): behave as if unset, so the
        // environment's value — if any — takes over instead of a blank.
        const plain = open(decoded);
        if (plain !== null) out[key] = plain;
      } else {
        out[key] = decoded;
      }
    } catch {
      // A row written by hand that is not JSON. Ignore it rather than crash
      // every page render over one bad value.
    }
  }

  return out;
}

export async function resolvedSettings(): Promise<ResolvedSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.resolved;

  let rows: Partial<Record<SettingKey, string>> = {};

  try {
    rows = await loadRows();
  } catch {
    // Before the first migration, or the database is briefly away. The
    // environment alone is a complete configuration.
  }

  const resolved = resolveSettings(rows, process.env);
  cache = { at: Date.now(), resolved };
  return resolved;
}

export async function getSettings(): Promise<Settings> {
  return (await resolvedSettings()).values;
}

/**
 * Write settings. A string stores it; null deletes the row, handing the key
 * back to the environment. Returns the keys that actually changed, for the
 * audit log.
 */
export async function writeSettings(
  patch: Partial<Record<SettingKey, string | null>>,
): Promise<SettingKey[]> {
  const before = await loadRows();
  const changed: SettingKey[] = [];

  await db.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(patch) as Array<
      [SettingKey, string | null | undefined]
    >) {
      if (value === undefined || !(key in DEFINITIONS)) continue;

      if (value === null) {
        if (before[key] === undefined) continue;
        await tx.appSetting.deleteMany({ where: { key } });
        changed.push(key);
        continue;
      }

      if (before[key] === value) continue;

      const stored = JSON.stringify(SECRET_KEYS.has(key) ? seal(value) : value);

      await tx.appSetting.upsert({
        where: { key },
        create: { key, value: stored },
        update: { value: stored },
      });
      changed.push(key);
    }
  });

  cache = null;
  return changed;
}

/** Which keys are secrets, so the panel can refuse to echo them back. */
export function isSecretSetting(key: SettingKey): boolean {
  return SECRET_KEYS.has(key);
}

export function settingEnvName(key: SettingKey): string {
  return DEFINITIONS[key];
}
