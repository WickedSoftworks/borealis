import { PublicShell } from "@/components/public-shell";

/**
 * A share token is a credential. Even though robots.txt disallows /s/, this
 * is the belt-and-braces: any crawler that reaches one anyway is told not to
 * index it, and the title must not leak the share's name into a tab, a
 * bookmark, or a link preview in whatever chat app it was pasted into.
 */
export const metadata = {
  title: "Shared files",
  description: "Files shared with you through Borealis.",
  robots: { index: false, follow: false, nocache: true },
};

export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell>{children}</PublicShell>;
}
