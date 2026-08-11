/**
 * Where the key rides.
 *
 * Keys travel in the URL's #fragment, which browsers never put on the wire —
 * not in the request line, not in Referer. The server therefore serves a share
 * page for a link whose key it has never seen and cannot log.
 *
 * A share can carry several files, each with its own key, so the fragment is a
 * list of pairs rather than a single value:
 *
 *     #k=<fileId>.<key>~<fileId>.<key>
 *
 * File ids are alphanumeric and keys are base64url (`A-Za-z0-9-_`), so `.` and
 * `~` cannot occur inside either half and need no escaping.
 */

const PREFIX = "k=";

export function encodeKeyFragment(
  pairs: Array<{ fileId: string; key: string }>,
): string {
  if (pairs.length === 0) return "";

  return `#${PREFIX}${pairs.map(({ fileId, key }) => `${fileId}.${key}`).join("~")}`;
}

/** Accepts the raw `location.hash`, with or without its leading `#`. */
export function decodeKeyFragment(hash: string): Record<string, string> {
  const body = hash.replace(/^#/, "");

  if (!body.startsWith(PREFIX)) return {};

  const keys: Record<string, string> = {};

  for (const pair of body.slice(PREFIX.length).split("~")) {
    const separator = pair.indexOf(".");

    if (separator > 0 && separator < pair.length - 1) {
      keys[pair.slice(0, separator)] = pair.slice(separator + 1);
    }
  }

  return keys;
}
