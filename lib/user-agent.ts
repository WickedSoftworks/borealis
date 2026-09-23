/**
 * "Firefox on Windows", from a User-Agent header.
 *
 * For the account page's session list and the access log, where a raw UA
 * string is noise and the question being asked is "is that me?". Deliberately
 * coarse — browser family and platform, no versions — because a precise guess
 * that is wrong is worse than a vague one that is right, and UA strings lie
 * in detail far more often than they lie in outline.
 */

const BROWSERS: Array<[RegExp, string]> = [
  // Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari".
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bSafari\//, "Safari"],
  [/\bcurl\//, "curl"],
  [/\bWget\//, "Wget"],
];

const PLATFORMS: Array<[RegExp, string]> = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";

  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1];
  const platform = PLATFORMS.find(([pattern]) => pattern.test(ua))?.[1];

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return `Browser on ${platform}`;

  return "Unknown device";
}
