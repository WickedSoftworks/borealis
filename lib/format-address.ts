/**
 * An address as a person reads it.
 *
 * better-auth stores session addresses fully expanded and, for IPv6, masked
 * to the /64 it rate-limits on — `2001:0db8:0001:0002:0000:0000:0000:0000` —
 * which is correct for its purposes and unreadable in a list. This compresses
 * IPv6 the standard way (RFC 5952: longest zero run to `::`, no leading
 * zeros) and says "/64" when the interface half is all zeros, so a masked
 * address is not mistaken for a specific machine.
 */
export function formatAddress(
  address: string | null | undefined,
): string | null {
  if (!address) return null;
  if (!address.includes(":")) return address;

  const groups = address.split(":");
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))
  ) {
    return address;
  }

  const values = groups.map((group) => Number.parseInt(group, 16));

  // IPv4-mapped: show the IPv4 client it is.
  if (values.slice(0, 5).every((v) => v === 0) && values[5] === 0xffff) {
    return `${values[6] >> 8}.${values[6] & 255}.${values[7] >> 8}.${values[7] & 255}`;
  }

  const masked = values.slice(4).every((value) => value === 0);

  // Longest run of zero groups, two or more long, becomes "::".
  let bestStart = -1;
  let bestLength = 0;

  for (let start = 0; start < 8; ) {
    if (values[start] !== 0) {
      start++;
      continue;
    }

    let end = start;
    while (end < 8 && values[end] === 0) end++;

    if (end - start > bestLength && end - start >= 2) {
      bestStart = start;
      bestLength = end - start;
    }

    start = end;
  }

  const hex = values.map((value) => value.toString(16));
  const compressed =
    bestStart < 0
      ? hex.join(":")
      : `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;

  return masked ? `${compressed}/64` : compressed;
}
