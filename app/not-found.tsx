import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/world/wordmark";

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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 py-5 sm:px-6">
      <Wordmark className="text-[24px]" />

      <div className="flex flex-1 flex-col justify-center gap-3 py-14">
        <span className="stamp rise">Not found</span>
        <h1
          className="rise text-balance font-serif text-[34px] font-medium leading-[1.15] tracking-[-0.02em] text-fg sm:text-[40px]"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          Nothing lives at this address
        </h1>
        <p
          className="rise text-[15px] leading-relaxed text-fg-muted"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          The link may have been mistyped, or it pointed at a share that has
          since been revoked. If someone sent it to you, ask them for a fresh
          one — links here are deliberately short-lived.
        </p>
        <div className="rise mt-3" style={{ "--i": 3 } as React.CSSProperties}>
          <Button asChild variant="default">
            <Link href="/">Go to the start</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
