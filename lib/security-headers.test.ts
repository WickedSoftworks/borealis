import { describe, expect, test } from "bun:test";
import {
  contentSecurityPolicy,
  isHttps,
  pageSecurityHeaders,
} from "./security-headers";

describe("page security headers", () => {
  test("a plain-HTTP deployment gets neither HSTS nor upgrade-insecure-requests", () => {
    const headers = pageSecurityHeaders({ https: false, dev: false });

    expect(headers["Strict-Transport-Security"]).toBeUndefined();
    expect(headers["Content-Security-Policy"]).not.toContain(
      "upgrade-insecure-requests",
    );
  });

  test("an HTTPS deployment gets both", () => {
    const headers = pageSecurityHeaders({ https: true, dev: false });

    expect(headers["Strict-Transport-Security"]).toContain("max-age=");
    expect(headers["Content-Security-Policy"]).toContain(
      "upgrade-insecure-requests",
    );
  });

  test("eval is allowed only in development", () => {
    expect(contentSecurityPolicy({ https: false, dev: true })).toContain(
      "'unsafe-eval'",
    );
    expect(contentSecurityPolicy({ https: false, dev: false })).not.toContain(
      "'unsafe-eval'",
    );
  });

  test("pages cannot be framed and cannot load plugins", () => {
    const csp = contentSecurityPolicy({ https: true, dev: false });

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  test("HTTPS is decided by the configured URL, not by the request", () => {
    expect(isHttps("https://files.example.com")).toBe(true);
    expect(isHttps("http://192.168.1.20:3000")).toBe(false);
    expect(isHttps(undefined)).toBe(false);
  });
});
