/**
 * Response headers for every page.
 *
 * A file host serves attacker-supplied content from the same origin as its
 * session cookie. The byte routes carry their own sandboxing policy
 * (lib/download.ts); these are the page-side half — what the dashboard, the
 * share page, and the login form are allowed to load and run.
 *
 * Computed per request in proxy.ts rather than baked into next.config.ts,
 * because two of them depend on the deployment: HSTS and
 * `upgrade-insecure-requests` are right on HTTPS and actively harmful on a
 * homelab box served over plain HTTP on the LAN, where they would break every
 * subresource the page loads. `next.config` headers are fixed at build time,
 * and a Docker image is built before anyone knows which of the two it will be.
 *
 * `'unsafe-inline'` stays in script-src: Next's hydration payload and the
 * no-flash theme script are inline, and the nonce alternative forces every
 * page to render dynamically. The policy still refuses scripts from any other
 * origin, plugins, framing, and form posts elsewhere, which is what stands
 * between an injected tag and a working exploit.
 */

export type SecurityContext = { https: boolean; dev: boolean };

export function contentSecurityPolicy({ https, dev }: SecurityContext): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // blob: for decrypted end-to-end files the browser opens itself.
    "media-src 'self' blob:",
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function pageSecurityHeaders(
  context: SecurityContext,
): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(context),
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    ...(context.https
      ? { "Strict-Transport-Security": "max-age=31536000" }
      : {}),
  };
}

/**
 * Whether this request reached the instance over HTTPS. The configured public
 * URL is the authority; a forwarded proto is believed only when it agrees,
 * so a client cannot talk a plain-HTTP deployment into sending HSTS.
 */
export function isHttps(configuredUrl: string | undefined): boolean {
  return (configuredUrl ?? "").toLowerCase().startsWith("https://");
}
