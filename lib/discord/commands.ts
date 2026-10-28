import { EXPIRY_PRESETS } from "@/lib/shares/expiry";

/**
 * The slash commands, as Discord registers them.
 *
 * One list, read by both the registration script (scripts/discord-register.mts)
 * and the handlers, so a command cannot be handled under one name and
 * registered under another.
 *
 * Installable on a server and on a person's own account, and usable in
 * servers, DMs and group DMs. Replies that carry a link are visible only to
 * the person who ran the command unless they ask to post it.
 */

/** Discord's option types, by name. */
export const OPTION = {
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  ATTACHMENT: 11,
} as const;

export const COMMAND = {
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  SEND: "send",
  SHARE: "share",
  LINKS: "links",
  REVOKE: "revoke",
  REQUEST: "request",
} as const;

const expiresOption = {
  type: OPTION.STRING,
  name: "expires",
  description: "When the link stops working (default: 1 week)",
  choices: EXPIRY_PRESETS.map((preset) => ({
    name: preset.label,
    value: preset.id,
  })),
};

const linkRules = [
  expiresOption,
  {
    type: OPTION.INTEGER,
    name: "downloads",
    description: "How many downloads before the link stops (default: no limit)",
    min_value: 1,
    max_value: 10000,
  },
  {
    type: OPTION.BOOLEAN,
    name: "password",
    description:
      "Protect the link with a generated password, shown only to you",
  },
  {
    type: OPTION.STRING,
    name: "name",
    description: "What the recipient sees as the title",
    max_length: 200,
  },
  {
    type: OPTION.BOOLEAN,
    name: "post",
    description:
      "Post the link in this channel (a password stays visible only to you)",
  },
];

const attachment = (name: string, required: boolean) => ({
  type: OPTION.ATTACHMENT,
  name,
  description: required ? "The file to send" : "Another file to include",
  required,
});

const everywhere = {
  type: 1,
  // 0: installed on a server, 1: installed on a user's account.
  integration_types: [0, 1],
  // 0: servers, 1: DMs with the app, 2: group DMs and other DMs.
  contexts: [0, 1, 2],
};

export const COMMANDS = [
  {
    ...everywhere,
    name: COMMAND.CONNECT,
    description: "Connect your Discord account to your Borealis account",
  },
  {
    ...everywhere,
    name: COMMAND.DISCONNECT,
    description: "Stop this Discord account acting for your Borealis account",
  },
  {
    ...everywhere,
    name: COMMAND.SEND,
    description: "Upload files to your vault and get a link to them",
    options: [
      attachment("file", true),
      attachment("file2", false),
      attachment("file3", false),
      ...linkRules,
    ],
  },
  {
    ...everywhere,
    name: COMMAND.SHARE,
    description: "Make a link to a file already in your vault",
    options: [
      {
        type: OPTION.STRING,
        name: "file",
        description: "Start typing a file name",
        required: true,
        autocomplete: true,
      },
      ...linkRules,
    ],
  },
  {
    ...everywhere,
    name: COMMAND.LINKS,
    description: "Your live links and what is left of each",
  },
  {
    ...everywhere,
    name: COMMAND.REVOKE,
    description: "Stop a link working, for everyone, right away",
    options: [
      {
        type: OPTION.STRING,
        name: "link",
        description: "Start typing the link's name",
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    ...everywhere,
    name: COMMAND.REQUEST,
    description: "Make a link someone can upload files to you through",
    options: [
      {
        type: OPTION.STRING,
        name: "name",
        description: "What the sender sees as the title",
        max_length: 200,
      },
      {
        type: OPTION.INTEGER,
        name: "files",
        description: "How many files it accepts (default: 20)",
        min_value: 1,
        max_value: 1000,
      },
      expiresOption,
      {
        type: OPTION.BOOLEAN,
        name: "post",
        description: "Post the link in this channel",
      },
    ],
  },
];
