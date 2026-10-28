import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import { appUrl } from "@/lib/appUrl";
import { getSettings } from "@/lib/settings";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Serif for what is read (titles, names, the summary of a link), sans for
// what is clicked, mono for every number and address. All three are variable,
// so one file each covers every weight in use.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

/**
 * The instance's own name, from the admin settings, in every title — an
 * operator who calls theirs "Files at Sam's" should not have every tab say
 * Borealis. Read per request; lib/settings.ts caches it.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { instanceName } = await getSettings();

  return {
    // Self-hosted, so the origin comes from the operator's own config rather
    // than a hardcoded domain. Canonical URLs resolve against this.
    metadataBase: new URL(appUrl()),
    title: {
      default:
        instanceName === "Borealis"
          ? "Borealis — self-hosted file sharing"
          : instanceName,
      // Routes set their own title; this keeps the instance name on all of them.
      template: `%s — ${instanceName}`,
    },
    description:
      "Self-hosted file sharing with password-protected links, expiring shares, and per-share transfer limits.",
    alternates: { canonical: "/" },
    applicationName: instanceName,
    robots: { index: true, follow: true },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the theme script below adds `light` to this
    // element before React hydrates, and that difference is intended.
    <html
      lang="en-US"
      className={`${newsreader.variable} ${inter.variable} ${jetbrainsMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed string from lib/theme.ts, no input reaches it
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
