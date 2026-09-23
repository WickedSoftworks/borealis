import { z } from "zod";

function hasControlCharacter(name: string): boolean {
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
  }

  return false;
}

/**
 * A filename as a person types it when renaming.
 *
 * Refused rather than repaired: control characters (an invisible difference
 * between two rows that look identical), and path separators — a name with a
 * `/` in it becomes a folder the moment it is put in a ZIP, and one with `\`
 * does on Windows. Everything else a filesystem somewhere accepts is allowed,
 * because the name is display text and `contentDisposition()` makes it safe
 * for headers.
 */
export const fileNameSchema = z
  .string()
  .trim()
  .min(1, "A name is required.")
  .max(255, "Keep it to 255 characters.")
  .refine((name) => !hasControlCharacter(name), {
    message: "Names cannot contain control characters.",
  })
  .refine((name) => !/[\\/]/.test(name), {
    message: "Names cannot contain / or \\.",
  })
  .refine((name) => name !== "." && name !== "..", {
    message: "That name is reserved.",
  });
