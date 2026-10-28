import { TriangleAlert } from "lucide-react";

/**
 * The two ways this interface speaks up.
 *
 * An error interrupts, so it is `role="alert"` and carries the danger colour
 * and an icon. A notice reports, so it is an `<output>`, the element that is
 * already a polite live region.
 */

export function ErrorSlab({ children }: { children: React.ReactNode }) {
  if (!children) return null;

  return (
    <p
      role="alert"
      className="flex gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm leading-relaxed text-fg"
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-danger"
        strokeWidth={1.75}
      />
      <span>{children}</span>
    </p>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  if (!children) return null;

  return (
    <output className="block text-sm leading-relaxed text-fg-muted">
      {children}
    </output>
  );
}

/** For "read this before you continue". */
export function Caution({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-warn-soft px-3 py-2.5 text-[13px] leading-relaxed text-fg-muted">
      {children}
    </p>
  );
}
