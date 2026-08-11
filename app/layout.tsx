import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { appUrl } from "@/lib/appUrl";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Self-hosted, so the origin comes from the operator's own config rather
  // than a hardcoded domain. Canonical URLs resolve against this.
  metadataBase: new URL(appUrl()),
  title: {
    default: "Borealis — self-hosted file sharing",
    // Routes set their own title; this keeps the product name on all of them.
    template: "%s — Borealis",
  },
  description:
    "Self-hosted file sharing with password-protected links, expiring shares, and per-share transfer limits.",
  alternates: { canonical: "/" },
  applicationName: "Borealis",
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-US" className={`${geistMono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        {/*
          THESIS: A file handed to someone you don't trust, on a visible leash. Refuses
          the self-hosted dashboard rut of dark ground, one neon accent, rounded cards.
          OWN-WORLD: Single-ink phosphor on a strict monospace cell grid. Tone is glyph
          density, never hue: the ramp . : - = + * @ draws meters, fills, and states.
          Green is the operator's own vault; amber is a hand-off to a stranger. Dotted
          hairline panels, inverted cells for active, block cursors, zero radius.
          STORY: The operator sees every limit on every share as a depleting quantity and
          trusts the box unattended. The recipient lands in amber, understands what they
          were given and for how long, and takes it.
          FIRST VIEWPORT: Vault header with live totals, then the file grid at full width,
          upload as a dense phosphor field, primary action inverted solid.
          FORM: Phosphor Glyph Grid; challenger, chosen over grounded candidate 5
          (safe-deposit vault); seed key 7b72caec.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the
          finish review, the verdict, and DESIGN.md
        */}
        {children}
      </body>
    </html>
  );
}
