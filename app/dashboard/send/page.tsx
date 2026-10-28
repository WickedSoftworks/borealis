import { SendComposer } from "@/components/send-composer";
import { getSession } from "@/lib/session";
import { shareFormContext } from "@/lib/shares/allowlist";

/**
 * "Send files" from the header: upload and get a link in one step. The
 * uploaded files land at the top of the vault, like any other upload, so
 * they can be shared again later.
 */
export default async function SendPage() {
  const session = await getSession();

  if (!session) return null;

  const context = await shareFormContext();

  return (
    <div className="flex flex-col gap-8">
      <div className="rise flex flex-col gap-1.5">
        <h1 className="font-serif text-4xl font-medium tracking-[-0.02em]">
          Send files
        </h1>
        <p className="font-serif text-lg text-fg-muted">
          Upload, set when the link ends, and send it.
        </p>
      </div>

      <SendComposer context={context} />
    </div>
  );
}
