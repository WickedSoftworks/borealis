import { Panel } from "@/components/world/panel";

const STEPS = [
  {
    title: "Store something",
    body: "Drop files into the field above, or choose them. Transfers resume if the connection drops. Tick “Encrypt in this browser” first for a file the server should never be able to read.",
  },
  {
    title: "Send it on a leash",
    body: "Select files or folders below and choose Share. Every link carries its own clock, download cap, transfer ceiling, and optional password — and records every fetch.",
  },
  {
    title: "Or collect instead",
    body: "“Collect files” makes a link that works the other way: anyone holding it can send files into your vault, without an account, up to the limits you set.",
  },
] as const;

/**
 * What a brand-new account sees, once.
 *
 * The empty file table says "nothing here" but not what this instance is for,
 * and the recipient-facing half of the product — the reason it exists — is
 * invisible until a link has been made. Three steps, in the order the
 * dashboard lays them out, and gone as soon as there is anything in the vault.
 */
export function GettingStarted() {
  return (
    <Panel title="Getting started" bodyClassName="p-0">
      <ol className="grid gap-0 md:grid-cols-3 md:divide-x md:divide-dotted md:divide-ink-20">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="border-b border-dotted border-ink-20 p-4 last:border-b-0 md:border-b-0"
          >
            <p className="text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
              {index + 1} · {step.title}
            </p>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-80">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
