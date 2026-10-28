import Link from "next/link";
import { ConnectDiscord } from "@/components/connect-discord";
import { Button } from "@/components/ui/button";
import { pendingLink } from "@/lib/discord/link";
import { getSession } from "@/lib/session";

export const metadata = {
  title: "Connect Discord",
  robots: { index: false, follow: false },
};

/**
 * Where a `/connect` link lands. Signed in by now (the dashboard sends anyone
 * else to sign in first, code and all), so all that is left is to say plainly
 * what connecting allows and ask.
 */
export default async function ConnectDiscordPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const { code } = await searchParams;
  const value = Array.isArray(code) ? code[0] : code;
  const link = value ? await pendingLink(value) : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-6">
      <div className="rise flex flex-col gap-2">
        <span className="stamp">Discord</span>
        <h1 className="font-serif text-4xl font-medium tracking-[-0.02em]">
          Connect Discord
        </h1>
      </div>

      {link && value ? (
        <>
          <p className="rise font-serif text-[19px] leading-relaxed text-fg">
            <strong className="font-semibold">{link.discordName}</strong> on
            Discord wants to act for{" "}
            <strong className="font-semibold">{session.user.email}</strong> on
            Borealis.
          </p>

          <div className="rise flex flex-col gap-2 rounded-xl border border-line bg-paper p-4 text-[14px] leading-relaxed text-fg-muted">
            <span className="label-caps">Once connected, it can</span>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>store files you send it in your vault, and link them</li>
              <li>make links to files already here, and collection links</li>
              <li>list your live links, and revoke them</li>
            </ul>
            <span>
              It can&apos;t sign in as you, read your password, or open
              encrypted files. Disconnect any time with{" "}
              <code className="data">/disconnect</code> or from your account
              settings.
            </span>
          </div>

          <ConnectDiscord code={value} />
        </>
      ) : (
        <>
          <p className="text-[15px] leading-relaxed text-fg-muted">
            This link has expired or was already used. Run{" "}
            <code className="data">/connect</code> in Discord again for a fresh
            one; each works once, for 15 minutes.
          </p>
          <div>
            <Button asChild variant="default">
              <Link href="/dashboard/account#discord">
                Discord in account settings
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
