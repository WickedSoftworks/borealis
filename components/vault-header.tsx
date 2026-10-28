"use client";

import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  Folder,
  Link2,
  LogOut,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { ThemeToggle } from "@/components/theme";
import { buttonVariants } from "@/components/ui/button";
import { Wordmark } from "@/components/world/wordmark";
import { authClient } from "@/lib/authClient";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Files", icon: Folder },
  { href: "/dashboard/links", label: "Shared links", icon: Link2 },
  { href: "/dashboard/activity", label: "Activity", icon: Activity },
] as const;

/**
 * The vault header: the name on the left, places in the middle, and the one
 * main action — sending files — beside the theme and account controls.
 *
 * The active place is underlined in the accent rather than filled, so the
 * only filled control in the header is the action.
 */
export function VaultHeader({
  name,
  email,
  role,
  instanceName,
  isAdmin,
  attention,
}: {
  name: string;
  email: string;
  role: string;
  instanceName: string;
  isAdmin: boolean;
  /** A link needs looking at: someone guessing its password, or a limit close. */
  attention: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const places = [
    ...NAV,
    ...(isAdmin
      ? [
          {
            href: "/dashboard/admin",
            label: "Admin",
            icon: ShieldCheck,
          } as const,
        ]
      : []),
  ];

  const displayName = name.trim() || email.split("@")[0];
  const initial = displayName.charAt(0).toUpperCase();

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-[1360px] flex-wrap items-center gap-x-7 gap-y-1 px-4 sm:px-8">
        <Link
          href="/dashboard"
          className="flex min-h-16 items-center rounded-sm"
        >
          <span className="flex items-baseline gap-2.5">
            <Wordmark className="text-[27px]" />
            <span className="hidden text-[13px] text-fg-subtle sm:inline">
              {instanceName}
            </span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2.5 md:order-last">
          <Link
            href="/dashboard/send"
            className={buttonVariants({ variant: "primary" })}
          >
            <ArrowUpRight aria-hidden="true" className="size-4" />
            Send files
          </Link>

          <ThemeToggle />

          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              className="flex h-11 items-center gap-2.5 rounded-lg pl-2.5 pr-1 text-left transition-colors hover:bg-raised data-[state=open]:bg-raised"
              aria-label={`Account menu for ${email}`}
            >
              <span className="hidden flex-col items-end leading-tight sm:flex">
                <span className="text-[13px] font-semibold text-fg">
                  {displayName}
                </span>
                <span className="text-xs text-fg-subtle">{role}</span>
              </span>
              <span
                aria-hidden="true"
                className="grid size-[34px] place-items-center rounded-full border border-line-strong bg-raised font-serif text-[15px] font-semibold italic text-accent"
              >
                {initial}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="size-3.5 text-fg-subtle"
              />
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 min-w-56 rounded-xl border border-line-strong bg-paper p-1.5 shadow-[var(--shadow-overlay)]"
              >
                <DropdownMenu.Label className="px-3 pb-2 pt-1.5 text-xs text-fg-subtle">
                  Signed in as <span className="text-fg-muted">{email}</span>
                </DropdownMenu.Label>
                <DropdownMenu.Item asChild>
                  <Link
                    href="/dashboard/account"
                    className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-raised"
                  >
                    <UserRound
                      aria-hidden="true"
                      className="size-4 text-fg-subtle"
                    />
                    Account settings
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-line" />
                <DropdownMenu.Item
                  onSelect={signOut}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-danger outline-none data-[highlighted]:bg-raised"
                >
                  <LogOut aria-hidden="true" className="size-4" />
                  Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <nav
          aria-label="Vault"
          className="-mx-1 flex w-full items-stretch gap-6 overflow-x-auto px-1 md:w-auto"
        >
          {places.map((place) => {
            const active =
              place.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(place.href);
            const Icon = place.icon;

            return (
              <Link
                key={place.href}
                href={place.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-12 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13.5px] transition-colors md:h-16",
                  active ? "text-fg" : "text-fg-subtle hover:text-accent",
                  active &&
                    "after:absolute after:inset-x-[-3px] after:bottom-[-1px] after:h-[1.5px] after:bg-accent",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className="size-3.5"
                  strokeWidth={1.75}
                />
                {place.label}
                {place.href === "/dashboard/links" && attention && (
                  <>
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-warn"
                    />
                    <span className="sr-only">, needs attention</span>
                  </>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
