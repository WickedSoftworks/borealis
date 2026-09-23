import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { GlyphText } from "@/components/world/glyph-text";
import { IconClock, IconDownload, IconLock } from "@/components/world/icons";
import { DensityMeter } from "@/components/world/meter";
import { DataRow, StateTag } from "@/components/world/panel";
import { RampLegend } from "@/components/world/ramp-legend";
import { getSession } from "@/lib/session";

export default async function Home() {
  if (await getSession()) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10 sm:py-14">
      <GlyphText as="h1" className="mb-7">
        BOREALIS
      </GlyphText>

      <div className="flex flex-col gap-6 border-b border-dotted border-ink-20 pb-8 lg:flex-row lg:items-end lg:justify-between">
        <p className="max-w-xl text-[0.9375rem] leading-relaxed text-ink-80">
          Hand a file to someone you don&apos;t know, on a leash you control.
          Every link carries its own password, clock, download count, and
          transfer ceiling — and records every fetch.
        </p>

        <Button
          asChild
          variant="primary"
          size="lg"
          className="self-start lg:self-auto"
        >
          <Link href="/login">Open the vault</Link>
        </Button>
      </div>

      {/*
        Demonstration rather than description: a real share's controls, filled
        with example values, so the mechanism is visible before sign-up. The
        figures are illustrative and labelled as such.
      */}
      <section className="mt-8 border border-dotted border-ink-20">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-dotted border-ink-20 px-3 py-2">
          <h2 className="text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
            What one link looks like
          </h2>
          <StateTag tone="quiet">Example</StateTag>
        </header>

        <div className="grid gap-0 md:grid-cols-[1fr_auto]">
          <div className="border-b border-dotted border-ink-20 p-4 md:border-b-0 md:border-r">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[0.9375rem] text-ink-90">
                Masters for review
              </span>

              <div className="flex gap-1.5">
                <StateTag tone="quiet">
                  <IconLock className="mr-1 inline size-3 align-[-2px]" />
                  Password
                </StateTag>
                <StateTag>
                  <IconClock className="mr-1 inline size-3 align-[-2px]" />
                  35h left
                </StateTag>
              </div>
            </div>

            <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2 sm:divide-x sm:divide-dotted sm:divide-ink-20">
              <DensityMeter
                label="Downloads used"
                value={2}
                max={3}
                cells={20}
                readout="2 of 3"
                className="sm:pr-8"
              />
              <DensityMeter
                label="Transfer used"
                value={6.1}
                max={10}
                cells={20}
                readout="6.1 GB of 10 GB"
                className="sm:pl-8"
              />
            </div>

            <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-60">
              One more download and this link stops working. So does a leak of
              it — and either way, the fetch is in the log with its time and
              address.
            </p>

            <RampLegend className="mt-5 border-t border-dotted border-ink-20 pt-4" />
          </div>

          <dl className="w-full p-4 md:w-64">
            <DataRow label="Database">SQLite or Postgres</DataRow>
            <DataRow label="Storage">Filesystem or S3</DataRow>
            <DataRow label="Uploads">Resumable, uncapped</DataRow>
            <DataRow label="Sign-in">Email, OAuth, OIDC</DataRow>
            <DataRow label="Licence">Self-hosted</DataRow>
          </dl>
        </div>
      </section>

      {/*
        Both columns share the panel's grid and its dotted divider, so the
        second thought is framed by the same system rather than floating
        unanchored beside it.
      */}
      <section className="mt-6 grid gap-0 border border-dotted border-ink-20 md:grid-cols-[1fr_auto]">
        <div className="border-b border-dotted border-ink-20 p-4 md:border-b-0 md:border-r">
          <h3 className="text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
            Why the limits matter
          </h3>
          <p className="mt-2 max-w-lg text-[0.8125rem] leading-relaxed text-ink-80">
            A link you send to a stranger will be forwarded, screenshotted, and
            kept. Borealis assumes that. The clock, the download count, and the
            transfer ceiling are what turn a leak from an open door into a
            bounded event you can read about afterwards.
          </p>
        </div>

        <div className="flex items-start gap-2 p-4 md:w-64">
          <IconDownload className="mt-0.5 size-4 shrink-0 text-ink-60" />
          <p className="text-[0.75rem] leading-relaxed text-ink-60">
            Recipients need no account. They open the link and take the file.
          </p>
        </div>
      </section>

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-dotted border-ink-20 pt-5 text-[0.6875rem] text-ink-60">
        <span>Borealis — self-hosted file sharing</span>
        <span className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/login"
            className="underline underline-offset-4 hover:text-ink-90"
          >
            Sign in
          </Link>
        </span>
      </footer>
    </main>
  );
}
