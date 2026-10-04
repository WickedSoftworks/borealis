/**
 * The instance's public origin.
 *
 * Self-hosted, so there is no single correct domain to hardcode — canonical
 * tags, robots, and the sitemap all derive from whatever the operator
 * configured for auth callbacks.
 */
export function appUrl(): string {
  const configured = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

  return configured.replace(/\/$/, "");
}

/**
 * Whether the cookies this app sets itself are `Secure`: when its public
 * origin is HTTPS, the rule better-auth applies to the session cookie.
 *
 * Not NODE_ENV. A production build served over plain HTTP on a LAN is a
 * supported setup, and a browser refuses a Secure cookie set over HTTP — so
 * the invitation and share-unlock cookies silently never stuck there, while
 * sign-in, deciding by the origin, worked.
 */
export function secureCookies(): boolean {
  return appUrl().startsWith("https://");
}
