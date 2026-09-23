/**
 * CRC-32 (IEEE 802.3), the checksum every ZIP entry carries.
 *
 * Incremental — `crc32(chunk, previous)` — because the archive writer computes
 * it over a stream it never holds whole. Node's zlib exposes `crc32` from 22
 * onward, but Bun's test runtime and older Nodes do not, and forty lines is
 * cheaper than a version check.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }

  return table;
})();

export function crc32(data: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0;

  for (let i = 0; i < data.length; i++) {
    crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }

  return ~crc >>> 0;
}
