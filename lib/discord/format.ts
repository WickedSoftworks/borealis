import { formatBytes, formatRemaining } from "@/lib/format";
import { nearLimit } from "@/lib/shares/attention";
import { downloadsExhausted, formatDownloads } from "@/lib/shares/downloads";

/**
 * Words for Discord. Pure, so the replies are tested without a server.
 *
 * Discord renders a little Markdown, so names are escaped before they are
 * bolded — a file called `**urgent**` should read as exactly that.
 */

/** Discord's ceiling on one message's content. */
const MAX_CONTENT = 2000;

export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>[\]()#-])/g, "\\$1");
}

export function clip(text: string, max = MAX_CONTENT): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export type LinkSummary = {
  id: string;
  kind: "SEND" | "REVERSE";
  name: string | null;
  url: string;
  expiresAt: Date | null;
  maxDownloads: number | null;
  downloadCount: number;
  egressLimitBytes: number | null;
  egressUsedBytes: number;
  hasPassword: boolean;
  /** Files carried, or files received for a collection link. */
  fileCount: number;
  maxUploadFiles: number | null;
};

function title(link: LinkSummary) {
  return (
    link.name ??
    (link.kind === "REVERSE"
      ? "Untitled collection link"
      : `${link.fileCount} file${link.fileCount === 1 ? "" : "s"}`)
  );
}

/** One line per link: name, where it stands, and the URL. */
export function linkLine(link: LinkSummary, now = Date.now()): string {
  const remaining = formatRemaining(link.expiresAt, now);
  const spent =
    link.kind === "SEND" &&
    ((link.maxDownloads !== null &&
      downloadsExhausted(link.downloadCount, link.maxDownloads)) ||
      (link.egressLimitBytes !== null &&
        link.egressUsedBytes >= link.egressLimitBytes));
  const ended = remaining === "expired" || spent;

  const facts = [
    ended
      ? "ended"
      : link.kind === "SEND" && nearLimit(link)
        ? "near its limit"
        : null,
    link.kind === "REVERSE"
      ? link.maxUploadFiles === null
        ? `${link.fileCount} received`
        : `${link.fileCount} of ${link.maxUploadFiles} received`
      : link.maxDownloads === null
        ? `${formatDownloads(link.downloadCount)} downloads`
        : `${formatDownloads(link.downloadCount)} of ${link.maxDownloads} downloads`,
    link.kind === "SEND" && link.egressLimitBytes !== null
      ? `${formatBytes(link.egressUsedBytes)} of ${formatBytes(link.egressLimitBytes)}`
      : null,
    remaining === null ? "no end date" : remaining,
    link.hasPassword ? "password" : null,
  ].filter(Boolean);

  return `**${escapeMarkdown(title(link))}** · ${facts.join(" · ")}\n<${link.url}>`;
}

export function linksMessage(links: LinkSummary[], now = Date.now()): string {
  if (links.length === 0) {
    return "You have no live links. Make one with `/send` or `/share`.";
  }

  const lines: string[] = [];
  let length = 0;

  for (const link of links) {
    const line = linkLine(link, now);
    // Leave room for the "and N more" line.
    if (length + line.length + 60 > MAX_CONTENT) break;
    lines.push(line);
    length += line.length + 2;
  }

  const hidden = links.length - lines.length;
  if (hidden > 0) {
    lines.push(`…and ${hidden} more on the Shared links page.`);
  }

  return lines.join("\n\n");
}

/** The label shown for a link in /revoke's suggestions. Discord caps it at 100. */
export function linkChoiceName(link: LinkSummary, now = Date.now()): string {
  const remaining = formatRemaining(link.expiresAt, now);
  return clip(
    `${title(link)} · ${remaining === null ? "no end date" : remaining}`,
    100,
  );
}
