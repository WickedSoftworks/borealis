/**
 * The Discord application the slash commands belong to.
 *
 * The same application signs people in with Discord (lib/auth.ts), so its id
 * and secret are the DISCORD_CLIENT_* pair already documented there. The
 * commands need one more value, the application's public key, which Discord
 * uses to sign every interaction it sends. Without it the endpoint stays off:
 * an unverifiable interaction must never be acted on.
 */
export type DiscordConfig = {
  applicationId: string;
  publicKey: string;
  /** For registering commands; DISCORD_BOT_TOKEN works instead. */
  clientSecret: string | null;
  botToken: string | null;
};

export function discordConfig(): DiscordConfig | null {
  const applicationId = process.env.DISCORD_CLIENT_ID?.trim();
  const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim();

  if (!applicationId || !publicKey) return null;

  return {
    applicationId,
    publicKey,
    clientSecret: process.env.DISCORD_CLIENT_SECRET?.trim() || null,
    botToken: process.env.DISCORD_BOT_TOKEN?.trim() || null,
  };
}
