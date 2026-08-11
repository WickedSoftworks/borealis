"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/authClient";

/**
 * The vault rail: identity on the left, register controls on the right.
 * The status lamp is a filled cell — the same mark the ramp uses at full density.
 */
export function VaultHeader({ email }: { email: string }) {
  const router = useRouter();
  const [light, setLight] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("borealis-register");
    const prefersLight = window.matchMedia(
      "(prefers-color-scheme: light)",
    ).matches;
    const useLight = stored ? stored === "light" : prefersLight;

    setLight(useLight);
    document.documentElement.classList.toggle("light", useLight);
  }, []);

  function toggleRegister() {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    localStorage.setItem("borealis-register", next ? "light" : "dark");
  }

  return (
    <header className="border-b border-dotted border-ink-20">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="size-2 bg-ink-100" />
          <span className="text-[0.75rem] font-bold uppercase tracking-[0.28em] text-ink-90">
            Borealis
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-[0.6875rem] text-ink-60 sm:inline">
            {email}
          </span>

          <Button variant="ghost" size="sm" onClick={toggleRegister}>
            {light ? "Screen" : "Paper"}
          </Button>

          <Button
            variant="quiet"
            size="sm"
            onClick={async () => {
              await authClient.signOut();
              router.push("/login");
              router.refresh();
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
