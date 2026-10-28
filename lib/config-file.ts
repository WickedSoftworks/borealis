import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";
import type { SettingKey } from "@/lib/settings";

/**
 * config.toml: the instance's settings as a file an operator can keep in
 * version control, beside the environment variables they mirror.
 *
 * It is one more source for the settings in lib/settings.ts — the admin panel
 * still wins over it, and it wins over the environment — plus the one thing
 * that has no environment variable: the instance rules, a Markdown file shown
 * on the front page.
 *
 * Read synchronously and cached on the files' modification times, so editing
 * either file takes effect without a restart. A file that will not parse is
 * reported, not fatal: the instance runs on its other sources and the admin
 * panel shows what went wrong.
 *
 * Only `import type` from lib/settings.ts — that module reads this one, and a
 * runtime import back would be a cycle.
 */

/** Where each setting lives in the file: `[table] key`. */
export const CONFIG_PATHS: Record<SettingKey, readonly [string, string]> = {
  "instance.name": ["instance", "name"],
  "storage.defaultQuota": ["storage", "default_quota"],
  "storage.ceiling": ["storage", "ceiling"],
  "uploads.maxFileSize": ["uploads", "max_file_size"],
  "audit.retentionDays": ["audit", "retention_days"],
  "security.deniedIps": ["security", "denied_ips"],
  "mail.host": ["mail", "host"],
  "mail.port": ["mail", "port"],
  "mail.user": ["mail", "user"],
  "mail.password": ["mail", "password"],
  "mail.from": ["mail", "from"],
  "mail.secure": ["mail", "secure"],
  "scan.infected": ["scan", "infected"],
  "scan.unscanned": ["scan", "unscanned"],
};

/** Keys the file takes that are not settings of their own. */
const EXTRA_KEYS = new Set(["instance.rules_file"]);

export const DEFAULT_RULES_FILE = "rules.md";

/** The rules are prose, not a novel; anything bigger is a mistake. */
const MAX_RULES_BYTES = 64 * 1024;

export type ParsedConfig = {
  values: Partial<Record<SettingKey, string>>;
  /** As written; resolved against the config file's folder by the reader. */
  rulesFile: string;
  errors: string[];
};

export type ConfigFile = ParsedConfig & {
  path: string;
  exists: boolean;
  /** Markdown, or null when there is no rules file. */
  rules: string | null;
  rulesPath: string;
};

/** `./data/config.toml` unless BOREALIS_CONFIG says otherwise. */
export function configPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return path.resolve(env.BOREALIS_CONFIG?.trim() || "data/config.toml");
}

function asSettingString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  // A list of addresses reads better as an array than as one long string.
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  ) {
    return value.join(", ");
  }
  return null;
}

/**
 * The pure half: TOML text in, setting strings out — in the same string form
 * an environment variable would give, so lib/settings.ts parses both alike.
 */
export function parseConfig(text: string): ParsedConfig {
  const errors: string[] = [];
  const values: Partial<Record<SettingKey, string>> = {};
  let rulesFile = DEFAULT_RULES_FILE;

  let document: Record<string, unknown>;

  try {
    document = parse(text) as Record<string, unknown>;
  } catch (error) {
    return {
      values,
      rulesFile,
      errors: [
        `config.toml could not be read: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      ],
    };
  }

  const known = new Set<string>([
    ...Object.values(CONFIG_PATHS).map(([table, key]) => `${table}.${key}`),
    ...EXTRA_KEYS,
  ]);

  for (const [table, body] of Object.entries(document)) {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      errors.push(`"${table}" should be a [${table}] section.`);
      continue;
    }

    for (const key of Object.keys(body)) {
      if (!known.has(`${table}.${key}`)) {
        errors.push(`[${table}] ${key} is not a setting; it is ignored.`);
      }
    }
  }

  for (const [setting, [table, key]] of Object.entries(CONFIG_PATHS) as Array<
    [SettingKey, readonly [string, string]]
  >) {
    const section = document[table];
    if (!section || typeof section !== "object") continue;

    const raw = (section as Record<string, unknown>)[key];
    if (raw === undefined) continue;

    const value = asSettingString(raw);

    if (value === null) {
      errors.push(`[${table}] ${key} should be text, a number, or true/false.`);
      continue;
    }

    values[setting] = value;
  }

  const instance = document.instance as Record<string, unknown> | undefined;

  if (instance && instance.rules_file !== undefined) {
    if (typeof instance.rules_file === "string" && instance.rules_file.trim()) {
      rulesFile = instance.rules_file.trim();
    } else {
      errors.push("[instance] rules_file should be a file name.");
    }
  }

  return { values, rulesFile, errors };
}

function mtime(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

let cached: { key: string; file: ConfigFile } | null = null;

/** The config file and the rules it points at, as they are on disk now. */
export function readConfigFile(
  env: Record<string, string | undefined> = process.env,
): ConfigFile {
  const file = configPath(env);
  const dir = path.dirname(file);
  const configTime = mtime(file);

  // The rules path depends on the config, so the cache key holds both times;
  // the rules time is looked up against the last known rules path.
  const guessRules =
    cached?.file.rulesPath ?? path.join(dir, DEFAULT_RULES_FILE);
  const key = `${file}:${configTime}:${guessRules}:${mtime(guessRules)}`;

  if (cached?.key === key) return cached.file;

  let parsed: ParsedConfig = {
    values: {},
    rulesFile: DEFAULT_RULES_FILE,
    errors: [],
  };

  if (configTime !== null) {
    try {
      parsed = parseConfig(readFileSync(file, "utf8"));
    } catch (error) {
      parsed.errors.push(
        `config.toml could not be opened: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const rulesPath = path.resolve(dir, parsed.rulesFile);
  let rules: string | null = null;
  const rulesTime = mtime(rulesPath);

  if (rulesTime !== null) {
    try {
      const text = readFileSync(rulesPath, "utf8");

      if (Buffer.byteLength(text) > MAX_RULES_BYTES) {
        parsed.errors.push(
          `${path.basename(rulesPath)} is over 64 KB and is not shown.`,
        );
      } else if (text.trim()) {
        rules = text;
      }
    } catch (error) {
      parsed.errors.push(
        `${path.basename(rulesPath)} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const result: ConfigFile = {
    ...parsed,
    path: file,
    exists: configTime !== null,
    rules,
    rulesPath,
  };

  cached = {
    key: `${file}:${configTime}:${rulesPath}:${rulesTime}`,
    file: result,
  };

  return result;
}
