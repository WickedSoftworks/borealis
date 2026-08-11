/**
 * Best-effort client IP for the share audit log.
 *
 * Trusts X-Forwarded-For only when TRUST_PROXY is set, since a self-hosted
 * instance exposed directly would otherwise let callers forge their own
 * audit-log entries.
 */
export function clientIp(req: Request): string | null {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = req.headers.get("x-forwarded-for");

    if (forwarded) {
      return forwarded.split(",")[0]?.trim() ?? null;
    }
  }

  return req.headers.get("x-real-ip");
}
