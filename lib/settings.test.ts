import { describe, expect, test } from "bun:test";
import { describeByteSize, parseByteSize } from "./bytes";
import { open, seal } from "./secret-box";
import { DEFAULT_INSTANCE_NAME, resolveSettings } from "./settings";

process.env.BETTER_AUTH_SECRET ??= "test-secret-not-used-outside-this-file";

describe("parseByteSize", () => {
  test("reads binary units, with or without a space", () => {
    expect(parseByteSize("1KB")).toBe(1024n);
    expect(parseByteSize("512 MB")).toBe(512n * 1024n ** 2n);
    expect(parseByteSize("1.5gb")).toBe(1610612736n);
    expect(parseByteSize("2 TiB")).toBe(2n * 1024n ** 4n);
    expect(parseByteSize("1048576")).toBe(1048576n);
  });

  test("every way of saying 'no ceiling' is null", () => {
    for (const raw of [undefined, null, "", "  ", "0", "none", "Unlimited"]) {
      expect(parseByteSize(raw)).toBeNull();
    }
  });

  test("refuses what it cannot read rather than guessing", () => {
    for (const raw of ["lots", "10 parsecs", "-5GB", "1e9"]) {
      expect(parseByteSize(raw)).toBeNull();
    }
  });

  test("round-trips through its description", () => {
    for (const bytes of [1024n, 50n * 1024n ** 3n, 1536n * 1024n ** 2n]) {
      expect(parseByteSize(describeByteSize(bytes))).toBe(bytes);
    }
  });
});

describe("secret box", () => {
  test("seals and opens", () => {
    const sealed = seal("hunter2");
    expect(sealed).not.toContain("hunter2");
    expect(open(sealed)).toBe("hunter2");
  });

  test("the same plaintext seals differently each time", () => {
    expect(seal("x")).not.toBe(seal("x"));
  });

  test("tampering or a foreign format opens to null, never throws", () => {
    const sealed = seal("hunter2");
    const tampered = `${sealed.slice(0, -2)}AA`;

    expect(open(tampered)).toBeNull();
    expect(open("plaintext")).toBeNull();
    expect(open("v2.a.b.c")).toBeNull();
  });
});

describe("resolveSettings", () => {
  test("an untouched instance is exactly its environment", () => {
    const { values, sources } = resolveSettings(
      {},
      {
        INSTANCE_NAME: "Files at Sam's",
        DEFAULT_QUOTA: "20GB",
        SMTP_HOST: "mail.example.com",
        SMTP_PORT: "465",
      },
    );

    expect(values.instanceName).toBe("Files at Sam's");
    expect(values.defaultQuotaBytes).toBe(20n * 1024n ** 3n);
    expect(values.mail.host).toBe("mail.example.com");
    expect(values.mail.port).toBe(465);
    expect(sources["instance.name"]).toBe("environment");
    expect(sources["storage.ceiling"]).toBe("default");
  });

  test("a stored value wins over the environment", () => {
    const { values, sources } = resolveSettings(
      { "instance.name": "Vault" },
      { INSTANCE_NAME: "From env" },
    );

    expect(values.instanceName).toBe("Vault");
    expect(sources["instance.name"]).toBe("database");
  });

  test("defaults fill every gap", () => {
    const { values } = resolveSettings({}, {});

    expect(values.instanceName).toBe(DEFAULT_INSTANCE_NAME);
    expect(values.defaultQuotaBytes).toBeNull();
    expect(values.auditRetentionDays).toBe(30);
    expect(values.mail).toEqual({
      host: null,
      port: 587,
      user: null,
      password: null,
      from: null,
      secure: null,
    });
  });

  test("an unusable retention falls back rather than purging everything", () => {
    for (const raw of ["0", "-1", "soon"]) {
      expect(
        resolveSettings({}, { AUDIT_RETENTION_DAYS: raw }).values
          .auditRetentionDays,
      ).toBe(30);
    }
  });

  test("SMTP_SECURE is tri-state", () => {
    const secure = (raw?: string) =>
      resolveSettings({}, { SMTP_SECURE: raw }).values.mail.secure;

    expect(secure("true")).toBe(true);
    expect(secure("false")).toBe(false);
    expect(secure(undefined)).toBeNull();
  });
});
