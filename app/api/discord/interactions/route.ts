import { after, NextResponse } from "next/server";
import { discordConfig } from "@/lib/discord/config";
import { handleInteraction, type Interaction } from "@/lib/discord/handlers";
import { verifyInteraction } from "@/lib/discord/verify";
import { log } from "@/lib/log";

export const runtime = "nodejs";

/**
 * Discord's Interactions Endpoint URL: every slash command arrives here as a
 * signed POST.
 *
 * Off (404) unless DISCORD_CLIENT_ID and DISCORD_PUBLIC_KEY are set. The body
 * is read as text first because the signature covers the exact bytes, and
 * nothing in it is believed until the signature checks out.
 */
export async function POST(request: Request) {
  const config = discordConfig();

  if (!config) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.text();

  if (
    !verifyInteraction({
      publicKey: config.publicKey,
      signature: request.headers.get("x-signature-ed25519"),
      timestamp: request.headers.get("x-signature-timestamp"),
      body,
    })
  ) {
    return NextResponse.json(
      { error: "Invalid request signature" },
      { status: 401 },
    );
  }

  let interaction: Interaction;

  try {
    interaction = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const handled = await handleInteraction(interaction, config);

  if (handled.later) {
    const later = handled.later;
    after(() =>
      later().catch((error) => log.error("discord.later_failed", { error })),
    );
  }

  return NextResponse.json(handled.body);
}
