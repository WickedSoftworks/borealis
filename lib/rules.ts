import MarkdownIt from "markdown-it";
import { readConfigFile } from "@/lib/config-file";

/**
 * The instance rules: the operator's Markdown file (rules.md beside
 * config.toml, or the file `[instance] rules_file` names), as HTML.
 *
 * Raw HTML in the file is escaped rather than passed through, and
 * markdown-it refuses `javascript:` and similar link targets, so the rules
 * can format text and link out but cannot put markup or script on the
 * page. Links open in a new tab and carry no referrer.
 */
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) =>
    self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer nofollow");
  return defaultLinkOpen(tokens, index, options, env, self);
};

export function renderRules(text: string): string {
  return markdown.render(text);
}

/** The rules as HTML, or null when the instance has none. */
export function instanceRules(): string | null {
  const { rules } = readConfigFile();
  return rules === null ? null : renderRules(rules);
}
