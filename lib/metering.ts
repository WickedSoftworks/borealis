import { type Readable, Transform } from "node:stream";

/**
 * A stream that reports how much passed through it.
 *
 * Egress has to be counted from the stream rather than from the file's size,
 * because those are different numbers the moment a client disconnects: someone
 * who takes 10 MB of a 4 GB file and closes the tab used 10 MB of the
 * operator's bandwidth, and a share's egress cap that pretends otherwise is
 * not a cap. Buffering the object made the two look identical; streaming it
 * makes the difference visible, and this is where it is measured.
 *
 * The count is of bytes that entered the meter, which on an aborted transfer
 * can run ahead of what reached the socket by up to the stream's high-water
 * mark. That is a few tens of kilobytes against caps measured in gigabytes,
 * and it errs towards charging slightly too much rather than too little —
 * the right direction for a limit whose job is to protect the operator.
 *
 * No storage, no database, no HTTP — so the counting can be tested on its own,
 * the way lib/checksum.ts is.
 */
export function meterStream(
  source: Readable,
  maxBytes?: bigint,
): {
  metered: Readable;
  served: () => bigint;
} {
  let served = 0n;

  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      if (maxBytes !== undefined && served + BigInt(chunk.length) > maxBytes) {
        callback(new Error("Stored object exceeds its reserved byte length"));
        return;
      }
      served += BigInt(chunk.length);
      callback(null, chunk);
    },
  });

  source.pipe(meter);
  source.once("error", (error) => meter.destroy(error));

  // `close` covers every ending: exhausted, errored, or destroyed because the
  // client hung up. Destroying the source on the way out is what stops an
  // abandoned download from holding a file descriptor or an S3 socket open.
  meter.once("close", () => source.destroy());

  return { metered: meter, served: () => served };
}
