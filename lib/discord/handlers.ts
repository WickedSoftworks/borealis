import { appUrl } from "@/lib/appUrl";
import { db } from "@/lib/db";
import { COMMAND } from "@/lib/discord/commands";
import type { DiscordConfig } from "@/lib/discord/config";
import {
  clip,
  escapeMarkdown,
  type LinkSummary,
  linkChoiceName,
  linksMessage,
} from "@/lib/discord/format";
import {
  issueLinkCode,
  LINK_CODE_TTL_MS,
  type LinkedUser,
  linkedUser,
  unlinkDiscordUser,
} from "@/lib/discord/link";
import {
  type DiscordMessage,
  EPHEMERAL,
  editReply,
  followUp,
} from "@/lib/discord/rest";
import { formatBytes } from "@/lib/format";
import { storeFile } from "@/lib/ingest";
import { log } from "@/lib/log";
import { hit, RULES } from "@/lib/rate-limit";
import { describeLink, generatePassword } from "@/lib/shares/composer";
import {
  type CreatedShare,
  createCollectionShare,
  createSendShare,
  revokeShare,
  ShareInputError,
} from "@/lib/shares/create";
import { EXPIRY_PRESETS, type ExpiryPresetId } from "@/lib/shares/expiry";

/**
 * What each slash command does.
 *
 * Every command acts as the Borealis account linked to the Discord user who
 * ran it — an id taken from an interaction whose signature the route has
 * already checked. Replies that carry a link or a password are ephemeral
 * (only that user sees them) unless the user asked to post.
 *
 * Discord wants an answer within three seconds. Anything that may take longer
 * — fetching attachments, hashing a password — answers "thinking…" at once and
 * finishes in `later`, which the route runs after the response has gone, then
 * edits the reply.
 */

/** Discord's interaction and response types, by name. */
const INTERACTION = { PING: 1, COMMAND: 2, AUTOCOMPLETE: 4 } as const;
const RESPONSE = {
  PONG: 1,
  MESSAGE: 4,
  DEFERRED_MESSAGE: 5,
  AUTOCOMPLETE: 8,
} as const;

/**
 * The largest attachment fetched into memory. Discord's own cap for most
 * people is far lower; anything bigger belongs on the website, whose uploads
 * stream and resume.
 */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
};

type Option = {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
};

type Attachment = {
  id: string;
  filename: string;
  size: number;
  url: string;
  content_type?: string;
};

export type Interaction = {
  type: number;
  token: string;
  application_id: string;
  data?: {
    name: string;
    options?: Option[];
    resolved?: { attachments?: Record<string, Attachment> };
  };
  user?: DiscordUser;
  member?: { user?: DiscordUser };
};

export type Handled = {
  /** The immediate HTTP response to Discord. */
  body: unknown;
  /** Work to finish after responding, ending in an edited reply. */
  later?: () => Promise<void>;
};

const say = (content: string, flags = EPHEMERAL): Handled => ({
  body: { type: RESPONSE.MESSAGE, data: reply({ content, flags }) },
});

function reply(message: DiscordMessage): DiscordMessage & {
  allowed_mentions: { parse: [] };
} {
  return { ...message, allowed_mentions: { parse: [] } };
}

function option<T extends string | number | boolean>(
  interaction: Interaction,
  name: string,
): T | undefined {
  return interaction.data?.options?.find((entry) => entry.name === name)
    ?.value as T | undefined;
}

function expiryPreset(value: string | undefined): ExpiryPresetId {
  return EXPIRY_PRESETS.some((preset) => preset.id === value)
    ? (value as ExpiryPresetId)
    : "1w";
}

/** A Discord timestamp: shown in each reader's own time zone. */
function discordTime(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

const NOT_LINKED =
  "Connect your Borealis account first: run `/connect`, then confirm in your browser.";

export async function handleInteraction(
  interaction: Interaction,
  config: DiscordConfig,
): Promise<Handled> {
  if (interaction.type === INTERACTION.PING) {
    return { body: { type: RESPONSE.PONG } };
  }

  const discordUser = interaction.member?.user ?? interaction.user;

  if (!discordUser || !interaction.data) {
    return say(
      "That didn't come with a Discord user, so there is no one to act for.",
    );
  }

  const limit = await hit(`discord:${discordUser.id}`, RULES.discordPerUser);

  if (!limit.allowed) {
    return interaction.type === INTERACTION.AUTOCOMPLETE
      ? { body: { type: RESPONSE.AUTOCOMPLETE, data: { choices: [] } } }
      : say("That's a lot of commands at once. Wait a minute and try again.");
  }

  const user = await linkedUser(discordUser.id);

  if (interaction.type === INTERACTION.AUTOCOMPLETE) {
    return {
      body: {
        type: RESPONSE.AUTOCOMPLETE,
        data: { choices: user ? await suggestions(interaction, user) : [] },
      },
    };
  }

  const name = interaction.data.name;

  if (name === COMMAND.CONNECT) return connect(discordUser, user);
  if (name === COMMAND.DISCONNECT) return disconnect(discordUser, user);

  if (!user) return say(NOT_LINKED);

  switch (name) {
    case COMMAND.LINKS:
      return say(linksMessage(await liveLinks(user.id)));
    case COMMAND.REVOKE:
      return revoke(interaction, user);
    case COMMAND.SEND:
    case COMMAND.SHARE:
    case COMMAND.REQUEST:
      return deferred(interaction, config, user);
    default:
      return say(`Borealis doesn't know \`/${name}\`.`);
  }
}

async function connect(
  discordUser: DiscordUser,
  user: LinkedUser | null,
): Promise<Handled> {
  if (user) {
    return say(
      `This Discord account is already connected to **${escapeMarkdown(user.email)}**. Run \`/disconnect\` first to switch accounts.`,
    );
  }

  const { url } = await issueLinkCode(
    discordUser.id,
    discordUser.global_name || discordUser.username,
  );
  const minutes = Math.round(LINK_CODE_TTL_MS / 60000);

  return {
    body: {
      type: RESPONSE.MESSAGE,
      data: reply({
        flags: EPHEMERAL,
        content: `Open this link, sign in to Borealis if it asks, and press **Connect**. It works once, for ${minutes} minutes.\n<${url}>`,
        // Discord only takes link buttons to https addresses.
        components: url.startsWith("https://")
          ? [
              {
                type: 1,
                components: [
                  { type: 2, style: 5, label: "Connect to Borealis", url },
                ],
              },
            ]
          : undefined,
      }),
    },
  };
}

async function disconnect(
  discordUser: DiscordUser,
  user: LinkedUser | null,
): Promise<Handled> {
  if (await unlinkDiscordUser(discordUser.id)) {
    return say(
      "Disconnected. This Discord account can no longer act for your Borealis account.",
    );
  }

  return say(
    user
      ? "This Discord account is how you sign in to Borealis, so it stays connected. Remove Discord sign-in in your account settings to disconnect it."
      : "This Discord account isn't connected to Borealis.",
  );
}

async function revoke(
  interaction: Interaction,
  user: LinkedUser,
): Promise<Handled> {
  const shareId = option<string>(interaction, "link") ?? "";

  const share = await db.share.findFirst({
    where: { id: shareId, ownerId: user.id },
    select: { name: true, token: true, type: true },
  });

  if (!share || !(await revokeShare(user.id, shareId))) {
    return say(
      "That link is already revoked or isn't yours. Pick one from the suggestions as you type.",
    );
  }

  const label =
    share.name ?? `/${share.type === "REVERSE" ? "r" : "s"}/${share.token}`;

  return say(
    `Revoked **${escapeMarkdown(label)}**. It stopped working for everyone, just now.`,
  );
}

/**
 * Commands that make a link. Answered "thinking…" at once, privately unless
 * the user asked to post, and finished in `later`.
 */
function deferred(
  interaction: Interaction,
  config: DiscordConfig,
  user: LinkedUser,
): Handled {
  const post = option<boolean>(interaction, "post") === true;
  const edit = (message: DiscordMessage) =>
    editReply(config.applicationId, interaction.token, message);

  return {
    body: {
      type: RESPONSE.DEFERRED_MESSAGE,
      data: { flags: post ? 0 : EPHEMERAL },
    },
    later: async () => {
      try {
        const name = interaction.data?.name;
        const result =
          name === COMMAND.REQUEST
            ? await request(interaction, user)
            : await send(interaction, user);

        if ("refused" in result) {
          await edit({ content: result.refused });
          return;
        }

        if (post) {
          await edit({ content: result.public });
          if (result.secret) {
            await followUp(config.applicationId, interaction.token, {
              content: result.secret,
              flags: EPHEMERAL,
            });
          }
        } else {
          await edit({
            content: clip(
              [result.public, result.secret].filter(Boolean).join("\n\n"),
            ),
          });
        }
      } catch (error) {
        log.error("discord.command_failed", {
          command: interaction.data?.name,
          error,
        });
        await edit({
          content:
            error instanceof ShareInputError
              ? error.message
              : "Something went wrong making that link. Nothing was shared; try again, or use the website.",
        }).catch(() => {});
      }
    },
  };
}

type Made = { public: string; secret: string | null } | { refused: string };

/** /send and /share: store any attachments, then link them. */
async function send(interaction: Interaction, user: LinkedUser): Promise<Made> {
  let fileIds: string[];

  if (interaction.data?.name === COMMAND.SEND) {
    const attachments = ["file", "file2", "file3"]
      .map((name) => option<string>(interaction, name))
      .map((id) => (id ? interaction.data?.resolved?.attachments?.[id] : null))
      .filter((attachment): attachment is Attachment => Boolean(attachment));

    if (attachments.length === 0) {
      return { refused: "Attach at least one file." };
    }

    const tooBig = attachments.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) {
      return {
        refused: `${escapeMarkdown(tooBig.filename)} is ${formatBytes(tooBig.size)}; files over ${formatBytes(MAX_ATTACHMENT_BYTES)} go through the website, where uploads resume. Nothing was stored.`,
      };
    }

    fileIds = [];

    for (const attachment of attachments) {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error(`Discord's CDN answered ${response.status}`);
      }

      const stored = await storeFile({
        ownerId: user.id,
        name: attachment.filename,
        mimeType: attachment.content_type ?? "application/octet-stream",
        data: Buffer.from(await response.arrayBuffer()),
      });

      if ("refused" in stored) {
        return {
          refused:
            fileIds.length > 0
              ? `${stored.refused} The ${fileIds.length} file${fileIds.length === 1 ? "" : "s"} before it ${fileIds.length === 1 ? "is" : "are"} in your vault, but no link was made.`
              : stored.refused,
        };
      }

      fileIds.push(stored.fileId);
    }
  } else {
    const fileId = option<string>(interaction, "file") ?? "";

    // The key to an encrypted file lives only in the browser that uploaded
    // it and travels in the link's fragment. The bot has neither, so a link
    // it made would hand the recipient bytes nobody can open.
    const encrypted = await db.file.findFirst({
      where: { id: fileId, ownerId: user.id, isEncrypted: true },
      select: { id: true },
    });

    if (encrypted) {
      return {
        refused:
          "That file is end-to-end encrypted, and its key is only in the browser that uploaded it. Share it from there.",
      };
    }

    fileIds = [fileId];
  }

  const preset = expiryPreset(option<string>(interaction, "expires"));
  const maxDownloads = option<number>(interaction, "downloads") ?? null;
  const password =
    option<boolean>(interaction, "password") === true
      ? generatePassword()
      : null;

  let share: CreatedShare;

  try {
    share = await createSendShare(user.id, {
      fileIds,
      folderIds: [],
      name: option<string>(interaction, "name")?.trim() || undefined,
      password: password ?? undefined,
      expiry: { mode: "preset", preset },
      maxDownloads,
      egressLimitBytes: null,
      viewOnly: false,
      isE2E: false,
      notifyOnDownload: false,
      notifyEmail: null,
      allowedIps: null,
    });
  } catch (error) {
    if (error instanceof ShareInputError && error.status === 404) {
      return {
        refused:
          "That file isn't in your vault. Pick one from the suggestions as you type.",
      };
    }
    throw error;
  }

  const summary = describeLink({
    files: fileIds.length,
    folders: 0,
    password: password !== null,
    viewOnly: false,
    maxDownloads,
    capGb: null,
    ends: share.expiresAt ? discordTime(share.expiresAt) : null,
    encrypted: 0,
  });

  const title = option<string>(interaction, "name")?.trim();

  return {
    public: `${title ? `**${escapeMarkdown(title)}**\n` : ""}${appUrl()}${share.url}\n${summary}`,
    secret: password
      ? `Password: \`${password}\`\nSend it another way — a text or a call — not alongside the link. If both travel together, a leak of one is a leak of both.`
      : null,
  };
}

/** /request: a collection link. */
async function request(
  interaction: Interaction,
  user: LinkedUser,
): Promise<Made> {
  const preset = expiryPreset(option<string>(interaction, "expires"));
  const files = option<number>(interaction, "files") ?? 20;
  const name = option<string>(interaction, "name")?.trim() || undefined;

  const share = await createCollectionShare(user.id, {
    name,
    expiry: { mode: "preset", preset },
    maxUploadFiles: files,
    maxUploadMb: null,
    requireUploader: true,
    allowedIps: null,
  });

  const until = share.expiresAt
    ? `until ${discordTime(share.expiresAt)}`
    : "until you revoke it";

  return {
    public: `${name ? `**${escapeMarkdown(name)}**\n` : ""}${appUrl()}${share.url}\nAnyone with this link can upload up to ${files} file${files === 1 ? "" : "s"} into your vault, ${until}.`,
    secret: null,
  };
}

/** Live links, newest first, in the shape the formatter takes. */
async function liveLinks(userId: string): Promise<LinkSummary[]> {
  const shares = await db.share.findMany({
    where: {
      ownerId: userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      type: true,
      token: true,
      name: true,
      expiresAt: true,
      maxDownloads: true,
      downloadCount: true,
      egressLimitBytes: true,
      egressUsedBytes: true,
      passwordHash: true,
      maxUploadFiles: true,
      _count: { select: { items: true } },
    },
  });

  return shares.map((share) => ({
    id: share.id,
    kind: share.type === "REVERSE" ? "REVERSE" : "SEND",
    name: share.name,
    url: `${appUrl()}/${share.type === "REVERSE" ? "r" : "s"}/${share.token}`,
    expiresAt: share.expiresAt,
    maxDownloads: share.maxDownloads,
    downloadCount: share.downloadCount,
    egressLimitBytes:
      share.egressLimitBytes === null ? null : Number(share.egressLimitBytes),
    egressUsedBytes: Number(share.egressUsedBytes),
    hasPassword: share.passwordHash !== null,
    fileCount: share._count.items,
    maxUploadFiles: share.maxUploadFiles,
  }));
}

/** Choices while typing: files for /share, live links for /revoke. */
async function suggestions(
  interaction: Interaction,
  user: LinkedUser,
): Promise<Array<{ name: string; value: string }>> {
  const focused = interaction.data?.options?.find((entry) => entry.focused);
  const typed = String(focused?.value ?? "").toLowerCase();

  if (interaction.data?.name === COMMAND.SHARE && focused?.name === "file") {
    const files = await db.file.findMany({
      where: { ownerId: user.id, deletedAt: null, isEncrypted: false },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, originalName: true, size: true, createdAt: true },
    });

    return files
      .filter((file) => file.originalName.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((file) => ({
        // Same-named uploads are common; the date tells them apart.
        name: clip(
          `${file.originalName} · ${formatBytes(Number(file.size))} · ${file.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
          100,
        ),
        value: file.id,
      }));
  }

  if (interaction.data?.name === COMMAND.REVOKE && focused?.name === "link") {
    const links = await liveLinks(user.id);

    return links
      .filter((link) => (link.name ?? link.url).toLowerCase().includes(typed))
      .slice(0, 25)
      .map((link) => ({ name: linkChoiceName(link), value: link.id }));
  }

  return [];
}
