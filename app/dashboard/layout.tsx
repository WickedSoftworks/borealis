import { redirect } from "next/navigation";
import { VaultHeader } from "@/components/vault-header";
import { getSession } from "@/lib/session";

export const metadata = {
  title: "Your vault",
  description: "Your stored files and the links you have sent out.",
  // A private surface: never indexed, never followed.
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Authoritative session check. proxy.ts only does an optimistic cookie
  // check and cannot be trusted for access control on its own.
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <VaultHeader email={session.user.email} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>

      {/* Anchors the page — without a closing rail the grid trails off into dead ground. */}
      <footer className="mt-8 border-t border-dotted border-ink-20">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-[0.6875rem] text-ink-60">
          <span>
            Every download is recorded against the link that served it.
          </span>
          <span>Borealis</span>
        </div>
      </footer>
    </div>
  );
}
