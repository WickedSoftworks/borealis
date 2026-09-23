/**
 * The two ways this interface speaks up.
 *
 * An error is the inverted slab — ink ground, lettering in the ground colour —
 * with `role="alert"`, because it interrupts. A notice is an `<output>`, the
 * element that is already a polite live region, because it reports. Same
 * shapes the existing forms use inline; named here so new ones do not drift.
 */

export function ErrorSlab({ children }: { children: React.ReactNode }) {
  if (!children) return null;

  return (
    <p
      role="alert"
      className="bg-ink-100 px-2 py-1 text-[0.75rem] font-bold text-ground"
    >
      {children}
    </p>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  if (!children) return null;

  return (
    <output className="block text-[0.75rem] leading-relaxed text-ink-90">
      {children}
    </output>
  );
}

/** The dotted-box aside used for "read this before you continue". */
export function Caution({ children }: { children: React.ReactNode }) {
  return (
    <p className="border border-dotted border-ink-40 px-2.5 py-2 text-[0.75rem] leading-relaxed text-ink-60">
      {children}
    </p>
  );
}
