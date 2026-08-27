import { z } from "zod";

/** Space. Everything below it, plus DEL, is a control character. */
const FIRST_PRINTABLE = 32;
const DELETE_CHAR = 127;

function hasControlCharacter(name: string): boolean {
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;

    if (code < FIRST_PRINTABLE || code === DELETE_CHAR) return true;
  }

  return false;
}

/**
 * A folder name as typed, minus surrounding whitespace.
 *
 * Control characters are refused rather than stripped: a name containing one
 * renders as an invisible difference between two otherwise identical rows, and
 * the sibling-name check would then disagree with what the eye can see.
 *
 * Its own module so the create and rename routes share one definition rather
 * than importing each other's.
 */
export const folderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((name) => !hasControlCharacter(name), {
    message: "Folder names cannot contain control characters",
  });
