import Link from "next/link";
import { redirect } from "next/navigation";
import { InstanceRules } from "@/components/instance-rules";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { DensityMeter } from "@/components/world/meter";
import { StateTag } from "@/components/world/panel";
import { Wordmark } from "@/components/world/wordmark";
import { instanceRules } from "@/lib/rules";
import { getSession } from "@/lib/session";

const FACTS = [
  ["Database", "SQLite or Postgres"],
  ["Storage", "Filesystem or S3"],
  ["Uploads", "Resumable, uncapped"],
  ["Sign-in", "Email, OAuth, OIDC"],
  ["Licence", "Self-hosted"],
] as const;

export default async function Home() {
  if (await getSession()) {
    redirect("/dashboard");
  }

  const rules = instanceRules();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-5 sm:px-8">
      <header className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-fg-subtle">
          Self-hosted file sharing
        </span>
        <span className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/login" className="link-quiet text-sm">
            Sign in
          </Link>
        </span>
      </header>

      <section className="flex flex-col gap-6 pb-12 pt-16 sm:pt-24">
        <Wordmark
          as="h1"
          className="rise text-[clamp(4.5rem,15vw,9rem)] leading-[0.9]"
        />
        <p
          className="rise max-w-2xl text-pretty font-serif text-[clamp(1.35rem,3vw,1.75rem)] leading-snug text-fg"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          Hand a file to someone you don&apos;t know, on a leash you control.
          Every link carries its own password, clock, download count and
          transfer ceiling, and records every fetch.
        </p>
        <div
          className="rise flex flex-wrap items-center gap-3"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <Button asChild variant="primary" size="lg" className="px-6">
            <Link href="/login">Open the vault</Link>
          </Button>
          <span className="text-[13.5px] text-fg-subtle">
            Recipients need no account. They open the link and take the file.
          </span>
        </div>
      </section>

      {/*
        Demonstration rather than description: a real share's controls, filled
        with example values, so the mechanism is visible before sign-up. The
        figures are illustrative and labelled as such.
      */}
      <section
        aria-labelledby="example"
        className="rise grid overflow-hidden rounded-2xl border border-line bg-paper md:grid-cols-[minmax(0,1fr)_17rem]"
        style={{ "--i": 3 } as React.CSSProperties}
      >
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 id="example" className="label-caps">
              What one link looks like
            </h2>
            <StateTag tone="quiet">Example</StateTag>
          </div>

          <div className="flex flex-col gap-1">
            <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="font-serif text-[22px] font-semibold tracking-[-0.012em] text-fg">
                Masters for review
              </span>
              <StateTag tone="alarm">Near its limit</StateTag>
            </span>
            <span className="data text-fg-subtle">
              2 files · password · /s/q7Xk…
            </span>
          </div>

          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <DensityMeter label="Time" value={0.8} max={1} readout="35h left" />
            <DensityMeter
              label="Downloads"
              value={2}
              max={3}
              readout="2 of 3"
              tone="alarm"
            />
            <DensityMeter
              label="Transfer"
              value={6.1}
              max={15}
              readout="6.1 GB of 15 GB"
            />
          </div>

          <p className="max-w-xl text-[13.5px] leading-relaxed text-fg-muted">
            One more download and this link stops working. So does a leak of it
            — and either way, the fetch is in the log with its time and address.
          </p>
        </div>

        <dl className="border-t border-line bg-ground/40 p-5 sm:p-6 md:border-l md:border-t-0">
          {FACTS.map(([term, detail]) => (
            <div
              key={term}
              className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0"
            >
              <dt className="text-[13px] text-fg-subtle">{term}</dt>
              <dd className="text-right text-[13.5px] text-fg">{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid gap-8 py-14 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="label-caps">Why the limits matter</h2>
          <p className="text-pretty font-serif text-[19px] leading-relaxed text-fg">
            A link you send to a stranger will be forwarded, screenshotted, and
            kept. Borealis assumes that. The clock, the download count and the
            transfer ceiling turn a leak from an open door into a bounded event
            you can read about afterwards.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="label-caps">And the other direction</h2>
          <p className="text-pretty font-serif text-[19px] leading-relaxed text-fg">
            Ask someone for files with a collection link. They upload straight
            into your vault, within the number and size you allow, until the
            link closes.
          </p>
        </div>
      </section>

      {/*
        The operator's own rules, from rules.md beside config.toml: what this
        instance is for and what it will not host, read before anyone signs
        in or is sent a link.
      */}
      {rules && (
        <section
          id="rules"
          aria-labelledby="rules-heading"
          className="flex scroll-mt-6 flex-col gap-4 border-t border-line pb-14 pt-10"
        >
          <h2 id="rules-heading" className="label-caps">
            Rules of this instance
          </h2>
          <InstanceRules html={rules} className="max-w-2xl" />
        </section>
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-[12.5px] text-fg-subtle">
        <span>Borealis — self-hosted file sharing</span>
        <span className="flex items-center gap-4">
          {rules && (
            <Link href="/rules" className="link-quiet">
              Rules
            </Link>
          )}
          <Link href="/login" className="link-quiet">
            Sign in
          </Link>
        </span>
      </footer>
    </main>
  );
}
