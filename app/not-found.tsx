import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Not found — Borealis",
  description: "That link doesn't point at anything on this Borealis instance.",
};

/**
 * Also the destination for a bad or revoked share token, so the copy has to
 * make sense to a recipient who was sent a link, not just to the operator.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-2.5">
          <span aria-hidden="true" className="size-2 bg-ink-100" />
          <span className="text-[13px] text-fg-subtle">Borealis</span>
        </div>

        <div className="border border-line p-5">
          <h1 className="text-[1.125rem] leading-snug text-fg">
            Nothing lives at this address
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-fg-subtle">
            The link may have been mistyped, or it pointed at a share that has
            since been revoked. If someone sent it to you, ask them for a fresh
            one — links here are deliberately short-lived.
          </p>

          <div className="mt-5">
            <Button asChild variant="primary">
              <Link href="/">Go to the start</Link>
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
