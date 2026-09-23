"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * The screen/paper switch, on every surface — the vault header and the public
 * pages alike. PRODUCT.md makes both themes first-class, and a control that
 * only the operator could reach was half of that. The choice is applied
 * before paint by `THEME_SCRIPT` (lib/theme.ts); this only changes it.
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
    setLight(next);
    document.documentElement.classList.toggle("light", next);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "light" : "dark");
    } catch {
      // Private mode: the choice lasts for this page, which is still a choice.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggle}
      className={className}
      aria-label={
        light === null
          ? "Switch theme"
          : light
            ? "Switch to the dark screen theme"
            : "Switch to the light paper theme"
      }
    >
      {light === null ? "Theme" : light ? "Screen" : "Paper"}
    </Button>
  );
}
