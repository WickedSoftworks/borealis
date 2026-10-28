import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CONFIG_PATHS, parseConfig, readConfigFile } from "./config-file";
import { SETTING_KEYS } from "./settings";

describe("parseConfig", () => {
  test("reads each setting into the string an env var would give", () => {
    const { values, errors } = parseConfig(`
[instance]
name = "Files at Sam's"

[storage]
default_quota = "50GB"

[audit]
retention_days = 90

[security]
denied_ips = ["192.0.2.0/24", "198.51.100.7"]

[mail]
secure = true

[scan]
infected = "allow"
`);

    expect(errors).toEqual([]);
    expect(values).toEqual({
      "instance.name": "Files at Sam's",
      "storage.defaultQuota": "50GB",
      "audit.retentionDays": "90",
      "security.deniedIps": "192.0.2.0/24, 198.51.100.7",
      "mail.secure": "true",
      "scan.infected": "allow",
    });
  });

  test("names unknown keys and bad values instead of failing", () => {
    const { values, errors } = parseConfig(`
[instance]
nmae = "typo"

[mail]
port = { nested = 1 }
`);

    expect(values).toEqual({});
    expect(errors).toEqual([
      "[instance] nmae is not a setting; it is ignored.",
      "[mail] port should be text, a number, or true/false.",
    ]);
  });

  test("a file that won't parse is reported, with nothing applied", () => {
    const { values, errors } = parseConfig("[instance\nname = 1");
    expect(values).toEqual({});
    expect(errors[0]).toStartWith("config.toml could not be read:");
  });

  test("every setting has a place in the file", () => {
    expect(Object.keys(CONFIG_PATHS).sort()).toEqual([...SETTING_KEYS].sort());
  });
});

describe("readConfigFile", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "borealis-config-"));
  const env = { BOREALIS_CONFIG: path.join(dir, "config.toml") };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("no file is a quiet, empty source", () => {
    const file = readConfigFile(env);
    expect(file.exists).toBe(false);
    expect(file.values).toEqual({});
    expect(file.rules).toBeNull();
    expect(file.errors).toEqual([]);
  });

  test("finds rules.md beside it, or the file it names", () => {
    writeFileSync(path.join(dir, "rules.md"), "# Be kind\n");
    expect(readConfigFile(env).rules).toBe("# Be kind\n");

    writeFileSync(path.join(dir, "terms.md"), "No malware.\n");
    writeFileSync(env.BOREALIS_CONFIG, '[instance]\nrules_file = "terms.md"\n');
    const file = readConfigFile(env);
    expect(file.exists).toBe(true);
    expect(file.rules).toBe("No malware.\n");
    expect(file.rulesPath).toBe(path.join(dir, "terms.md"));
  });
});
