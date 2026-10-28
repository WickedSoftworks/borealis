import type { DiscordConfig } from "@/lib/discord/config";

// Overridable only so the commands can be exercised against a local stand-in
// for Discord; nothing in a real deployment sets it.
const API = process.env.DISCORD_API_BASE ?? "https://discord.com/api/v10";

/** A message body as Discord takes it. Mentions are never parsed. */
export type DiscordMessage = {
  content?: string;
  flags?: number;
  components?: unknown[];
};

/** Visible only to the person who ran the command. */
export const EPHEMERAL = 1 << 6;

function body(message: DiscordMessage) {
  return JSON.stringify({ ...message, allowed_mentions: { parse: [] } });
}

async function send(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  if (!response.ok) {
    throw new Error(
      `Discord answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }

  return response;
}

/**
 * Replace the deferred "thinking…" reply with the real one. Authorised by the
 * interaction's own token, which Discord issues per interaction for 15
 * minutes, so no bot token is involved.
 */
export function editReply(
  applicationId: string,
  token: string,
  message: DiscordMessage,
) {
  return send(`${API}/webhooks/${applicationId}/${token}/messages/@original`, {
    method: "PATCH",
    body: body(message),
  });
}

/** A further message after the first, e.g. a password kept private. */
export function followUp(
  applicationId: string,
  token: string,
  message: DiscordMessage,
) {
  return send(`${API}/webhooks/${applicationId}/${token}`, {
    method: "POST",
    body: body(message),
  });
}

/**
 * The header that may manage this application's commands: the bot token when
 * there is one, otherwise a short-lived token from the client-credentials
 * grant, which needs only the id and secret sign-in already uses.
 */
async function managementAuth(config: DiscordConfig): Promise<string> {
  if (config.botToken) return `Bot ${config.botToken}`;

  if (!config.clientSecret) {
    throw new Error(
      "Set DISCORD_CLIENT_SECRET or DISCORD_BOT_TOKEN to register commands.",
    );
  }

  const response = await send(`${API}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${config.applicationId}:${config.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "applications.commands.update",
    }).toString(),
  });

  const { access_token } = (await response.json()) as { access_token: string };

  return `Bearer ${access_token}`;
}

/** Replace the application's global commands with `commands`. */
export async function registerCommands(
  config: DiscordConfig,
  commands: unknown[],
): Promise<Array<{ name: string }>> {
  const response = await send(
    `${API}/applications/${config.applicationId}/commands`,
    {
      method: "PUT",
      headers: { Authorization: await managementAuth(config) },
      body: JSON.stringify(commands),
    },
  );

  return response.json();
}
