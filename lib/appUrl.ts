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
