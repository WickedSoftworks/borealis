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

/**
 * Public hand-off surfaces run in the amber register.
 *
 * Same grid, same ramp, same components — only the hue moves. A recipient
 * should be able to tell at a glance that they are holding someone else's file
 * rather than standing in their own vault.
 */
export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="register-amber flex min-h-full flex-1 flex-col bg-ground">
      {children}
    </div>
  );
}
