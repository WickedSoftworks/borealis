import {
  isSecretSetting,
  resolvedSettings,
  SETTING_KEYS,
  type SettingKey,
  type SettingSource,
  settingEnvName,
} from "@/lib/settings";

export type SettingView = {
  key: SettingKey;
  env: string;
  source: SettingSource;
  secret: boolean;
  /** The raw text in effect. Always null for a secret. */
  value: string | null;
  /** Whether a secret has any value at all. */
  isSet: boolean;
};

/**
 * What the settings form renders: for every key, the value in effect, where
 * it came from, and the environment variable it would fall back to. A secret
 * is reported only as set or not — the form can replace it, never read it.
 */
export async function settingsSnapshot(): Promise<SettingView[]> {
  const { sources, raw } = await resolvedSettings();

  return SETTING_KEYS.map((key) => ({
    key,
    env: settingEnvName(key),
    source: sources[key],
    secret: isSecretSetting(key),
    value: isSecretSetting(key) ? null : (raw[key] ?? null),
    isSet: Boolean(raw[key]),
  }));
}
