import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { meterStream } from "./metering";

/**
 * Subscribe BEFORE consuming, never after: by the time a drained stream is
 * awaited, `close` has already fired and a listener attached then waits
 * forever. The same trap lives in lib/download.ts, which is why the accounting
 * promise there is created while the stream is still live.
 */
function closed(stream: Readable): Promise<void> {
  return new Promise((resolve) => stream.once("close", () => resolve()));
}

describe("meterStream", () => {
  test("counts every byte that passes through", async () => {
    const source = Readable.from([
      Buffer.alloc(100),
      Buffer.alloc(50),
      Buffer.alloc(1),
    ]);
    const { metered, served } = meterStream(source);
    const done = closed(metered);

    for await (const _chunk of metered) {
      // drain
    }
    await done;

    expect(served()).toBe(151n);
  });

  test("counts nothing for an empty object", async () => {
    const { metered, served } = meterStream(Readable.from([]));
    const done = closed(metered);

    for await (const _chunk of metered) {
      // drain
    }
    await done;

    expect(served()).toBe(0n);
  });

  test("reports only what got through when the consumer gives up", async () => {
    // The case the egress cap exists for: a recipient who takes part of a file
    // and disconnects has used part of the bandwidth, not none and not all.
    //
    // The chunks are deliberately large. Backpressure is what stops the meter
    // running ahead of the consumer, and it only engages past the high-water
    // mark — a handful of small chunks would be pulled through in one go and
    // the count would look complete. That is the same reason the overcount on
    // a real abort is bounded by the high-water mark rather than being zero.
    const chunk = 256 * 1024;
    const total = BigInt(chunk * 40);
    const source = Readable.from(
      Array.from({ length: 40 }, () => Buffer.alloc(chunk)),
    );
    const { metered, served } = meterStream(source);
    const done = closed(metered);

    for await (const _chunk of metered) {
      break;
    }
    await done;

    expect(served()).toBeGreaterThan(0n);
    expect(served()).toBeLessThan(total);
  });

  test("destroys the source when the meter is torn down", async () => {
    // An abandoned download must not leave a file descriptor or an S3 socket
    // open behind it.
    const source = Readable.from([Buffer.alloc(10), Buffer.alloc(10)]);
    const { metered } = meterStream(source);
    const done = closed(metered);

    metered.destroy();
    await done;

    expect(source.destroyed).toBe(true);
  });

  test("a source that dies partway does not report a full count", async () => {
    const source = new Readable({
      read() {
        this.push(Buffer.alloc(8));
        this.destroy(new Error("disk went away"));
      },
    });
    const { metered, served } = meterStream(source);
    const done = closed(metered);

    metered.on("error", () => {});
    metered.resume();
    await done;

    expect(served()).toBeLessThanOrEqual(8n);
  });
});
