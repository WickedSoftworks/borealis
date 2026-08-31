import { z } from "zod";
import { EXPIRY_PRESETS, type ExpiryPresetId } from "./expiry";

/**
 * The wire shape of an expiry choice, shared by share creation and share edit.
 *
 * Kept out of `./expiry` on purpose: that module is imported by
 * `components/expiry-field.tsx`, and putting zod in it would ship the validator
 * to every browser that renders the field.
 *
 * The preset list is derived from `EXPIRY_PRESETS` rather than restated, so a
 * new preset cannot be offered by the interface and rejected by the API.
 */
const presetIds = EXPIRY_PRESETS.map((preset) => preset.id) as [
  ExpiryPresetId,
  ...ExpiryPresetId[],
];

export const expirySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("preset"), preset: z.enum(presetIds) }),
  z.object({
    mode: z.literal("duration"),
    value: z.number().positive(),
    unit: z.enum(["minutes", "hours", "days", "weeks"]),
  }),
  z.object({ mode: z.literal("until"), date: z.string() }),
]);
