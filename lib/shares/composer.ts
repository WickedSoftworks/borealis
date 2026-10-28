/**
 * The share composer's rules, kept apart from the form so the presets and the
 * sentence that describes a link can be tested without a browser.
 *
 * A preset is not stored anywhere. It is a named set of rules, and the form
 * shows a preset as chosen whenever its rules are exactly the ones set, so
 * changing any rule by hand moves the form to "Custom" without extra state.
 */

export type ComposerRules = {
  /** An EXPIRY_PRESETS id, or "other" for a custom duration or a date. */
  expiry: string;
  password: boolean;
  maxDownloads: number | null;
  /** Transfer cap in GB; null for none. */
  capGb: number | null;
};

export type ComposerPreset = {
  id: "handoff" | "review" | "private" | "custom";
  label: string;
  /** The rules in a few words, shown under the label. */
  summary: string;
  rules: ComposerRules;
};

export const COMPOSER_PRESETS: ComposerPreset[] = [
  {
    id: "handoff",
    label: "Quick hand-off",
    summary: "24 hours · 1 download",
    rules: { expiry: "24h", password: false, maxDownloads: 1, capGb: null },
  },
  {
    id: "review",
    label: "Client review",
    summary: "1 week · password · 3 downloads · 15 GB",
    rules: { expiry: "1w", password: true, maxDownloads: 3, capGb: 15 },
  },
  {
    id: "private",
    label: "Private",
    summary: "24 hours · password · 1 download",
    rules: { expiry: "24h", password: true, maxDownloads: 1, capGb: null },
  },
  {
    id: "custom",
    label: "Custom",
    summary: "set each rule yourself",
    rules: { expiry: "1w", password: false, maxDownloads: null, capGb: null },
  },
];

/** The preset whose rules are exactly these, or "custom". */
export function matchPreset(rules: ComposerRules): ComposerPreset["id"] {
  const match = COMPOSER_PRESETS.find(
    (preset) =>
      preset.id !== "custom" &&
      preset.rules.expiry === rules.expiry &&
      preset.rules.password === rules.password &&
      preset.rules.maxDownloads === rules.maxDownloads &&
      preset.rules.capGb === rules.capGb,
  );

  return match?.id ?? "custom";
}

/** "this file", "these 3 files", "these 2 files and 1 folder". */
export function describeItems(files: number, folders: number): string {
  const parts = [
    files > 0 && `${files} file${files === 1 ? "" : "s"}`,
    folders > 0 && `${folders} folder${folders === 1 ? "" : "s"}`,
  ].filter(Boolean);

  if (parts.length === 0) return "nothing yet";
  if (files + folders === 1) return folders === 1 ? "this folder" : "this file";

  return `these ${parts.join(" and ")}`;
}

/**
 * What a link allows, as one or two plain sentences.
 *
 * Written so an owner can check the link against what they meant before it
 * exists: who can open it, how often, until when, and what ends it. A link
 * with nothing bounding it says so in as many words.
 */
export function describeLink({
  files,
  folders,
  password,
  viewOnly,
  maxDownloads,
  capGb,
  ends,
  encrypted,
}: {
  files: number;
  folders: number;
  password: boolean;
  viewOnly: boolean;
  maxDownloads: number | null;
  capGb: number | null;
  /** When it stops working, already in words; null for never. */
  ends: string | null;
  /** How many of the files are end-to-end encrypted. */
  encrypted: number;
}): string {
  const who = password
    ? "Anyone with this link and the password"
    : "Anyone with this link";
  const what = describeItems(files, folders);

  const times = viewOnly
    ? ""
    : maxDownloads === null
      ? " any number of times"
      : maxDownloads === 1
        ? " once"
        : ` up to ${maxDownloads} times`;

  const until = ends === null ? "until you revoke it" : `until ${ends}`;
  const cap =
    capGb === null || viewOnly
      ? ""
      : `, or until ${capGb} GB has been sent in total`;

  const bounded =
    ends !== null || capGb !== null || (maxDownloads !== null && !viewOnly);

  let sentence = viewOnly
    ? `${who} can view ${what} in the browser, but not download ${files + folders === 1 ? "it" : "them"}, ${until}.`
    : `${who} can download ${what}${times}, ${until}${cap}.`;

  sentence += bounded
    ? " After that, it stops working."
    : " Nothing limits this link but you.";

  if (encrypted > 0) {
    sentence +=
      encrypted === files
        ? " The files are encrypted; the server holds bytes it cannot read."
        : ` ${encrypted} of the files ${encrypted === 1 ? "is" : "are"} encrypted; the server holds bytes it cannot read.`;
  }

  return sentence;
}

// No 0/o, 1/l/i: a password read aloud or copied by hand should survive it.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * A password to send separately from the link: three groups of four, about
 * 59 bits. Random from the platform's CSPRNG, with rejection sampling so no
 * character is likelier than another.
 */
export function generatePassword(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) =>
    crypto.getRandomValues(bytes),
): string {
  const limit = 256 - (256 % ALPHABET.length);
  const out: string[] = [];

  while (out.length < 12) {
    for (const byte of random(new Uint8Array(16))) {
      if (byte < limit && out.length < 12) {
        out.push(ALPHABET[byte % ALPHABET.length]);
      }
    }
  }

  return [out.slice(0, 4), out.slice(4, 8), out.slice(8)]
    .map((group) => group.join(""))
    .join("-");
}
