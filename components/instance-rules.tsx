import { cn } from "@/lib/utils";

/**
 * The operator's rules, already rendered to safe HTML by lib/rules.ts (raw
 * HTML escaped, script links refused), in the page's reading style.
 */
export function InstanceRules({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  return (
    <div
      className={cn("rules-prose", className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered by markdown-it with html disabled; see lib/rules.ts
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
