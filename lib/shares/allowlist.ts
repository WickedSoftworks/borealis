import { z } from "zod";
import { mailConfigured } from "@/lib/email";
import { parseCidrList, parseTrustProxy } from "@/lib/request";

/**
 * A link's address allow list, as the API accepts it.
 *
 * Blank means "anyone" and is stored as null, the same "null is unlimited"
 * convention every other limit uses. Anything that does not parse is refused
 * with the offending entries named, rather than silently dropped: an allow
 * list that quietly ignored a typo would let in exactly the network its owner
 * meant to keep out. Stored normalised — one comma between entries — so the
 * edit form shows it back the way the guard reads it.
 */
export const allowedIpsSchema = z
  .string()
  .max(2000)
  .nullable()
  .transform((value, context) => {
    if (value === null || value.trim() === "") return null;

    const { ranges, invalid } = parseCidrList(value);

    if (invalid.length > 0) {
      context.addIssue({
        code: "custom",
        message: `Not an address or range: ${invalid.join(", ")}`,
      });
      return z.NEVER;
    }

    if (ranges.length === 0) return null;

    return value
      .split(/[\s,]+/)
      .filter(Boolean)
      .join(", ");
  });

/**
 * What the share forms need to tell the truth about two fields: whether an
 * emailed notification will actually be sent, and whether this instance can
 * see recipients' addresses at all — without that, an allow list refuses
 * everyone (lib/shares/guard.ts, `addressAllowed`).
 */
export async function shareFormContext(): Promise<{
  mailConfigured: boolean;
  addressesVisible: boolean;
}> {
  return {
    mailConfigured: await mailConfigured(),
    addressesVisible: parseTrustProxy(process.env.TRUST_PROXY).mode !== "none",
  };
}
