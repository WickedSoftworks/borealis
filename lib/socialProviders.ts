/**
 * Which OAuth providers are configured. Computed server-side from env so the
 * login form only renders buttons that will actually work.
 */
export const SOCIAL_PROVIDERS = [
  { id: "discord", label: "Discord", prefix: "DISCORD" },
  { id: "github", label: "GitHub", prefix: "GITHUB" },
  { id: "google", label: "Google", prefix: "GOOGLE" },
  { id: "microsoft", label: "Microsoft", prefix: "MICROSOFT" },
] as const;

export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number]["id"];

export type EnabledProvider = { id: SocialProviderId | "oidc"; label: string };

export function getEnabledProviders(): EnabledProvider[] {
  const enabled: EnabledProvider[] = SOCIAL_PROVIDERS.filter(
    (p) =>
      process.env[`${p.prefix}_CLIENT_ID`] &&
      process.env[`${p.prefix}_CLIENT_SECRET`],
  ).map((p) => ({ id: p.id, label: p.label }));

  if (
    process.env.OIDC_ISSUER &&
    process.env.OIDC_CLIENT_ID &&
    process.env.OIDC_CLIENT_SECRET
  ) {
    enabled.push({
      id: "oidc",
      label: process.env.OIDC_DISPLAY_NAME ?? "Single Sign-On",
    });
  }

  return enabled;
}
