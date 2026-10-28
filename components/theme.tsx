"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The light/dark switch, on every surface — the vault header and the public
 * pages alike. PRODUCT.md makes both themes first-class, and a control that
 * only the operator could reach was half of that. The choice is applied
 * before paint by `THEME_SCRIPT` (lib/theme.ts); this only changes it.
 *
 * It names the theme it switches *to*, so the label is an action.
 */
export function ThemeToggle({ className }: { className?: string }) {
  // Null until mounted: the server cannot know, and guessing would render the
  // wrong label for half the visitors before correcting itself.
  const [light, setLight] = useState<boolean | null>(null);

  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
  }, []);

  function toggle() {
    const next = !light;
    const root = document.documentElement;

    // Every colour transition would otherwise fire at once and smear the
    // swap: switch them off, change the theme, flush styles, switch back on.
    root.classList.add("theme-swapping");
    setLight(next);
    root.classList.toggle("light", next);
    void root.offsetHeight;
    requestAnimationFrame(() => root.classList.remove("theme-swapping"));

    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "light" : "dark");
    } catch {
      // Private mode: the choice lasts for this page, which is still a choice.
    }
  }

  const Icon = light ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-xs font-medium text-fg-muted transition-[color,scale] duration-150 hover:text-accent enabled:active:scale-[0.96] motion-reduce:enabled:active:scale-100",
        className,
      )}
      aria-label={
        light === null
          ? "Switch theme"
          : light
            ? "Switch to the dark theme"
            : "Switch to the light theme"
      }
    >
      {light !== null && (
        <Icon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
      )}
      {light === null ? "Theme" : light ? "Dark" : "Light"}
    </button>
  );
}
