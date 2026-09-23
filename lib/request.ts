/**
 * Who is on the other end of a request, and how far to believe it.
 *
 * Next does not hand route handlers the socket address. What it does is set
 * `X-Forwarded-For` to that address — but only when the request did not arrive
 * with one already (`??=` in next/dist/server/base-server.js). So on an
 * instance exposed directly, the header is the truth for an honest client and
 * whatever an attacker typed for a dishonest one, and nothing downstream can
 * tell the two apart. Behind a proxy, the proxy decides what the header says.
 *
 * `TRUST_PROXY` says which of those worlds this is, with the semantics Express
 * made familiar:
 *
 *   false (default)  no proxy is trusted. The audit log records no address,
 *                    because every source of one is forgeable here.
 *   true             trust every hop: the LEFTMOST address is the client. Only
 *                    safe when the proxy strips an incoming X-Forwarded-For,
 *                    since otherwise a client prepends whatever it likes.
 *   <n>              trust the last n hops: count n from the right.
 *   <cidr list>      trust those addresses (e.g. "10.0.0.0/8, 172.16.0.0/12"):
 *                    walk from the right, skipping trusted proxies, and the
 *                    first address that is not one is the client.
 *
 * The last two are the forms that stay correct when a client sends its own
 * X-Forwarded-For through a proxy that appends — which is what nginx's
 * `$proxy_add_x_forwarded_for` does.
 *
 * Everything above `clientIp` is pure and tested in lib/request.test.ts.
 */

// ------------------------------------------------------------- Addresses --

type ParsedIp = { family: 4 | 6; value: bigint };

function parseIpv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;

  let value = 0n;

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }

  return value;
}

function parseIpv6(text: string): bigint | null {
  let input = text;

  // An embedded IPv4 tail ("::ffff:192.0.2.1") becomes two hextets.
  const lastColon = input.lastIndexOf(":");
  const tail = input.slice(lastColon + 1);

  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    input = `${input.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }

  const halves = input.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;

  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && missing < 1) return null;

  const groups = [
    ...head,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"),
    ...rest,
  ];

  let value = 0n;

  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }

  return value;
}

/**
 * Parse an address, normalising the two forms that mean an IPv4 client:
 * IPv4-mapped IPv6 (`::ffff:1.2.3.4`, which is how a dual-stack socket
 * reports one) and a bracketed or zone-suffixed IPv6 literal.
 */
export function parseIp(raw: string): ParsedIp | null {
  let text = raw.trim();
  if (!text) return null;

  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end < 0) return null;
    text = text.slice(1, end);
  }

  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);

  if (!text.includes(":")) {
    const v4 = parseIpv4(text);
    return v4 === null ? null : { family: 4, value: v4 };
  }

  const v6 = parseIpv6(text);
  if (v6 === null) return null;

  // ::ffff:0:0/96 is an IPv4 address wearing IPv6 clothes.
  if (v6 >> 32n === 0xffffn) {
    return { family: 4, value: v6 & 0xffffffffn };
  }

  return { family: 6, value: v6 };
}

export type CidrRange = { family: 4 | 6; base: bigint; bits: number };

/** "10.0.0.0/8", "2001:db8::/32", or a bare address meaning a /32 or /128. */
export function parseCidr(raw: string): CidrRange | null {
  const [address, prefix, ...extra] = raw.trim().split("/");
  if (extra.length > 0 || !address) return null;

  const ip = parseIp(address);
  if (!ip) return null;

  const width = ip.family === 4 ? 32 : 128;
  const bits = prefix === undefined ? width : Number(prefix);

  if (!Number.isInteger(bits) || bits < 0 || bits > width) return null;
  if (prefix !== undefined && !/^\d+$/.test(prefix)) return null;

  const mask =
    bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(width - bits);

  return { family: ip.family, base: ip.value & mask, bits };
}

export function ipInRange(ip: ParsedIp, range: CidrRange): boolean {
  if (ip.family !== range.family) return false;

  const width = ip.family === 4 ? 32 : 128;
  const mask =
    range.bits === 0
      ? 0n
      : ((1n << BigInt(range.bits)) - 1n) << BigInt(width - range.bits);

  return (ip.value & mask) === range.base;
}

/**
 * Parse a comma- or whitespace-separated list of addresses and ranges.
 * Returns the ranges and every entry that did not parse, so a form can refuse
 * a typo instead of silently ignoring it.
 */
export function parseCidrList(raw: string): {
  ranges: CidrRange[];
  invalid: string[];
} {
  const ranges: CidrRange[] = [];
  const invalid: string[] = [];

  for (const entry of raw.split(/[\s,]+/)) {
    if (!entry) continue;
    const range = parseCidr(entry);
    if (range) ranges.push(range);
    else invalid.push(entry);
  }

  return { ranges, invalid };
}

/** Whether `address` falls inside any range of `list`. */
export function ipMatchesList(address: string, list: CidrRange[]): boolean {
  const ip = parseIp(address);
  return ip !== null && list.some((range) => ipInRange(ip, range));
}

// --------------------------------------------------------------- Proxies --

export type ProxyTrust =
  | { mode: "none" }
  | { mode: "all" }
  | { mode: "hops"; hops: number }
  | { mode: "ranges"; ranges: CidrRange[] };

/**
 * Read `TRUST_PROXY`. An unparseable value falls back to trusting nothing,
 * which fails towards "no address recorded" rather than towards "forgeable".
 */
export function parseTrustProxy(raw: string | undefined): ProxyTrust {
  const value = raw?.trim().toLowerCase() ?? "";

  if (value === "" || value === "false" || value === "0" || value === "no") {
    return { mode: "none" };
  }

  if (value === "true" || value === "yes") return { mode: "all" };

  if (/^\d+$/.test(value)) {
    return { mode: "hops", hops: Number(value) };
  }

  const { ranges, invalid } = parseCidrList(value);

  if (ranges.length === 0 || invalid.length > 0) return { mode: "none" };

  return { mode: "ranges", ranges };
}

/** `X-Forwarded-For` split into addresses, leftmost first. */
export function forwardedChain(header: string | null | undefined): string[] {
  if (!header) return [];

  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => parseIp(part) !== null);
}

/**
 * The client address under a given trust policy, or null when the policy
 * says nothing can be believed.
 */
export function resolveClientIp(
  forwardedFor: string | null | undefined,
  trust: ProxyTrust,
): string | null {
  const chain = forwardedChain(forwardedFor);

  switch (trust.mode) {
    case "none":
      return null;

    case "all":
      return chain[0] ?? null;

    case "hops": {
      // Next records the socket address itself only when no proxy did, so the
      // chain as received already ends at the nearest proxy's view of its
      // client. n trusted hops means the n-th entry from the right.
      if (trust.hops <= 0) return null;
      return chain[chain.length - trust.hops] ?? chain[0] ?? null;
    }

    case "ranges": {
      for (let index = chain.length - 1; index >= 0; index--) {
        const address = chain[index];
        if (!ipMatchesList(address, trust.ranges)) return address;
      }

      // Every hop is a trusted proxy: the leftmost is as close as we get.
      return chain[0] ?? null;
    }
  }
}

// --------------------------------------------------------------- Request --

let cachedTrust: { raw: string | undefined; trust: ProxyTrust } | undefined;

function proxyTrust(): ProxyTrust {
  const raw = process.env.TRUST_PROXY;

  if (!cachedTrust || cachedTrust.raw !== raw) {
    cachedTrust = { raw, trust: parseTrustProxy(raw) };
  }

  return cachedTrust.trust;
}

type HeaderSource = Request | Headers | { get(name: string): string | null };

function headersOf(source: HeaderSource) {
  return source instanceof Request ? source.headers : source;
}

/**
 * Best-effort client IP for the share audit log, the lockout, and per-link
 * allow lists — null when `TRUST_PROXY` says no source can be believed.
 */
export function clientIp(source: HeaderSource): string | null {
  return resolveClientIp(
    headersOf(source).get("x-forwarded-for"),
    proxyTrust(),
  );
}

/**
 * The address to count rate-limit hits against.
 *
 * Deliberately looser than `clientIp`: when no proxy is trusted it falls back
 * to the leftmost forwarded address, which on a directly exposed instance is
 * the real socket address for anyone who did not forge the header. A limiter
 * keyed on a forgeable address is still worth having — it stops every naive
 * brute-forcer — and anything that must not be dodgeable (the share unlock
 * lockout) is keyed on the share, not on this.
 */
export function rateLimitAddress(source: HeaderSource): string {
  const headers = headersOf(source);

  return (
    clientIp(headers) ??
    forwardedChain(headers.get("x-forwarded-for"))[0] ??
    "unknown"
  );
}
