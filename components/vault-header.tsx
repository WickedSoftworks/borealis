"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/authClient";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Vault" },
  { href: "/dashboard/activity", label: "Activity" },
  { href: "/dashboard/account", label: "Account" },
] as const;

/**
 * The vault rail: identity on the left, places and register controls on the
 * right. The status lamp is a filled cell — the same mark the ramp uses at
 * full density. The active place is the inverted cell, as selection is
 * everywhere else in this world.
 */
export function VaultHeader({
  email,
  instanceName,
  isAdmin,
}: {
  email: string;
  instanceName: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const places = [
    ...NAV,
    ...(isAdmin ? [{ href: "/dashboard/admin", label: "Admin" } as const] : []),
  ];

  return (
    <header className="border-b border-dotted border-ink-20">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="size-2 bg-ink-100" />
          <span className="text-[0.75rem] font-bold uppercase tracking-[0.28em] text-ink-90">
            {instanceName}
          </span>
        </div>

        <nav
          aria-label="Vault"
          className="order-last flex w-full gap-1 sm:order-none sm:w-auto"
        >
          {places.map((place) => {
            const active =
              place.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(place.href);

            return (
              <Link
                key={place.href}
                href={place.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "px-2 py-1 text-[0.6875rem] uppercase tracking-[0.18em] transition-colors",
                  active
                    ? "bg-ink-100 font-bold text-ground"
                    : "text-ink-60 hover:text-ink-100",
                )}
              >
                {place.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <span className="hidden text-[0.6875rem] text-ink-60 md:inline">
            {email}
          </span>

          <ThemeToggle />

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
