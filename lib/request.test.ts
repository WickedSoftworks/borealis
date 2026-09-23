import { describe, expect, test } from "bun:test";
import {
  forwardedChain,
  ipMatchesList,
  parseCidr,
  parseCidrList,
  parseIp,
  parseTrustProxy,
  resolveClientIp,
} from "./request";

describe("parseIp", () => {
  test("reads IPv4 and IPv6", () => {
    expect(parseIp("192.0.2.1")).toEqual({ family: 4, value: 3221225985n });
    expect(parseIp("::1")?.family).toBe(6);
    expect(parseIp("2001:db8::1")?.family).toBe(6);
  });

  test("an IPv4-mapped IPv6 address is the IPv4 client it wraps", () => {
    expect(parseIp("::ffff:192.0.2.1")).toEqual(parseIp("192.0.2.1"));
  });

  test("strips brackets and zone ids", () => {
    expect(parseIp("[2001:db8::1]")).toEqual(parseIp("2001:db8::1"));
    expect(parseIp("fe80::1%eth0")).toEqual(parseIp("fe80::1"));
  });

  test("refuses things that are not addresses", () => {
    for (const bad of ["", "256.0.0.1", "1.2.3", "hello", "1::2::3", "::g"]) {
      expect(parseIp(bad)).toBeNull();
    }
  });
});

describe("parseCidr", () => {
  test("masks the base so a sloppy range still matches", () => {
    const range = parseCidr("10.1.2.3/8");
    expect(range).not.toBeNull();
    expect(ipMatchesList("10.200.0.1", range ? [range] : [])).toBe(true);
  });

  test("a bare address is a single-host range", () => {
    const range = parseCidr("203.0.113.9");
    expect(range?.bits).toBe(32);
  });

  test("refuses prefixes wider than the family", () => {
    expect(parseCidr("10.0.0.0/33")).toBeNull();
    expect(parseCidr("::/129")).toBeNull();
    expect(parseCidr("10.0.0.0/x")).toBeNull();
  });
});

describe("parseCidrList", () => {
  test("reports typos rather than dropping them", () => {
    const { ranges, invalid } = parseCidrList(
      "10.0.0.0/8, 192.168.1.1 bogus\n2001:db8::/32",
    );
    expect(ranges).toHaveLength(3);
    expect(invalid).toEqual(["bogus"]);
  });

  test("never matches across address families", () => {
    const { ranges } = parseCidrList("::/0");
    expect(ipMatchesList("192.0.2.1", ranges)).toBe(false);
    expect(ipMatchesList("2001:db8::1", ranges)).toBe(true);
  });
});

describe("parseTrustProxy", () => {
  test("unset, false, and garbage all trust nothing", () => {
    for (const raw of [undefined, "", "false", "0", "no", "10.0.0.0/8,oops"]) {
      expect(parseTrustProxy(raw)).toEqual({ mode: "none" });
    }
  });

  test("true trusts every hop, a number trusts that many", () => {
    expect(parseTrustProxy("true")).toEqual({ mode: "all" });
    expect(parseTrustProxy("2")).toEqual({ mode: "hops", hops: 2 });
  });

  test("a list of ranges trusts those proxies", () => {
    expect(parseTrustProxy("10.0.0.0/8, 172.16.0.0/12").mode).toBe("ranges");
  });
});

describe("resolveClientIp", () => {
  // A client that forged its own header, behind one proxy that appended the
  // address it actually saw — nginx's $proxy_add_x_forwarded_for.
  const forged = "6.6.6.6, 198.51.100.7";

  test("trusting nothing records nothing", () => {
    expect(resolveClientIp(forged, { mode: "none" })).toBeNull();
  });

  test("trusting everything believes the forgery", () => {
    // The documented weakness of TRUST_PROXY=true, pinned so it stays visible.
    expect(resolveClientIp(forged, { mode: "all" })).toBe("6.6.6.6");
  });

  test("one trusted hop takes what the proxy appended", () => {
    expect(resolveClientIp(forged, { mode: "hops", hops: 1 })).toBe(
      "198.51.100.7",
    );
  });

  test("two hops step past an outer proxy", () => {
    // CDN edge → nginx → Borealis. The CDN appended the client, nginx the edge.
    expect(
      resolveClientIp("6.6.6.6, 198.51.100.7, 104.16.0.1", {
        mode: "hops",
        hops: 2,
      }),
    ).toBe("198.51.100.7");
  });

  test("trusted ranges are skipped from the right", () => {
    const trust = parseTrustProxy("104.16.0.0/12");
    expect(resolveClientIp("6.6.6.6, 198.51.100.7, 104.16.0.1", trust)).toBe(
      "198.51.100.7",
    );
  });

  test("a chain made only of trusted proxies yields its leftmost entry", () => {
    const trust = parseTrustProxy("10.0.0.0/8");
    expect(resolveClientIp("10.0.0.5, 10.0.0.1", trust)).toBe("10.0.0.5");
  });

  test("an absent header is no address under any policy", () => {
    expect(resolveClientIp(null, { mode: "all" })).toBeNull();
    expect(resolveClientIp(undefined, { mode: "hops", hops: 1 })).toBeNull();
  });
});

describe("forwardedChain", () => {
  test("drops entries that are not addresses", () => {
    expect(forwardedChain("unknown, 192.0.2.1, , _hidden")).toEqual([
      "192.0.2.1",
    ]);
  });
});
