import Link from "next/link";
import { ThemeToggle } from "@/components/theme";
import { Wordmark } from "@/components/world/wordmark";
import { readConfigFile } from "@/lib/config-file";
import { getSettings } from "@/lib/settings";

/**
 * The frame around everything a recipient sees: the mark, the theme switch,
 * and a footer that says what this page is. One narrow column, because the
 * page is often the whole experience for someone arriving from a chat
 * message on a phone.
 */
export async function PublicShell({ children }: { children: React.ReactNode }) {
  const { instanceName } = await getSettings();
  const hasRules = readConfigFile().rules !== null;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ground">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pb-5 pt-5 sm:px-6">
        <header className="flex items-center justify-between gap-3">
          <Wordmark className="text-[24px]" />
          <ThemeToggle />
        </header>

        <div className="flex flex-1 flex-col py-10 sm:py-14">{children}</div>

        <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-4 text-[12.5px] text-fg-subtle">
          <span>Shared privately · no account needed</span>
          <span className="flex items-center gap-3">
            {hasRules && (
              <Link href="/rules" className="link-quiet">
                Rules
              </Link>
            )}
            <span>{instanceName}</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
