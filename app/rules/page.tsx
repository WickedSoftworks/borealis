import { notFound } from "next/navigation";
import { InstanceRules } from "@/components/instance-rules";
import { PublicShell } from "@/components/public-shell";
import { instanceRules } from "@/lib/rules";
import { getSettings } from "@/lib/settings";

export async function generateMetadata() {
  const { instanceName } = await getSettings();
  return {
    title: `Rules — ${instanceName}`,
    description: `What ${instanceName} is for, and what it will not host.`,
  };
}

/** The instance rules on their own page, linked from sign-in and shared links. */
export default async function RulesPage() {
  const rules = instanceRules();
  if (!rules) notFound();

  const { instanceName } = await getSettings();

  return (
    <PublicShell>
      <main className="flex flex-col gap-6">
        <div className="rise flex flex-col gap-2">
          <span className="stamp">{instanceName}</span>
          <h1 className="font-serif text-[34px] font-medium leading-[1.15] tracking-[-0.02em] text-fg sm:text-[40px]">
            Rules of this instance
          </h1>
        </div>
        <InstanceRules html={rules} className="rise" />
      </main>
    </PublicShell>
  );
}
