import { describe, expect, test } from "bun:test";
import { formatAddress } from "./format-address";

describe("formatAddress", () => {
  test("IPv4 and absent addresses pass through", () => {
    expect(formatAddress("192.0.2.1")).toBe("192.0.2.1");
    expect(formatAddress(null)).toBeNull();
  });

  test("compresses a fully expanded IPv6 address", () => {
    expect(formatAddress("2001:0db8:0000:0000:0000:ff00:0042:8329")).toBe(
      "2001:db8::ff00:42:8329",
    );
  });

  test("says /64 when better-auth masked the interface half", () => {
    expect(formatAddress("2001:0db8:0001:0002:0000:0000:0000:0000")).toBe(
      "2001:db8:1:2::/64",
    );
    expect(formatAddress("0000:0000:0000:0000:0000:0000:0000:0000")).toBe(
      "::/64",
    );
  });

  test("an IPv4-mapped address is shown as the IPv4 client", () => {
    expect(formatAddress("0000:0000:0000:0000:0000:ffff:c000:0201")).toBe(
      "192.0.2.1",
    );
  });

  test("already-compact or odd input is left alone", () => {
    expect(formatAddress("::1")).toBe("::1");
    expect(formatAddress("not an address")).toBe("not an address");
  });
});
