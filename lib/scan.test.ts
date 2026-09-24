import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import { parseClamdReply, scanStream } from "./scan";

describe("parseClamdReply", () => {
  test("OK is clean", () => {
    expect(parseClamdReply("stream: OK\0")).toEqual({ status: "CLEAN" });
  });

  test("FOUND names the signature", () => {
    expect(parseClamdReply("stream: Eicar-Test-Signature FOUND\0")).toEqual({
      status: "INFECTED",
      signature: "Eicar-Test-Signature",
    });
  });

  test("anything else is an error, never a clean bill", () => {
    expect(() =>
      parseClamdReply("INSTREAM size limit exceeded. ERROR\0"),
    ).toThrow();
    expect(() => parseClamdReply("")).toThrow();
  });
});

/**
 * A fake clamd that speaks just enough INSTREAM to check the framing: it
 * reassembles the chunks and answers FOUND if the payload contains a marker.
 */
function fakeClamd(): Promise<{
  port: number;
  close: () => void;
  seen: () => string;
}> {
  let received = "";

  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let commandRead = false;

    socket.on("data", (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);

      if (!commandRead) {
        const nul = buffer.indexOf(0);
        if (nul < 0) return;
        expect(buffer.subarray(0, nul).toString()).toBe("zINSTREAM");
        buffer = buffer.subarray(nul + 1);
        commandRead = true;
      }

      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);

        if (length === 0) {
          socket.end(
            received.includes("MALWARE")
              ? "stream: Test.Marker FOUND\0"
              : "stream: OK\0",
          );
          return;
        }

        if (buffer.length < 4 + length) return;
        received += buffer.subarray(4, 4 + length).toString();
        buffer = buffer.subarray(4 + length);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : 0,
        close: () => server.close(),
        seen: () => received,
      });
    });
  });
}

describe("scanStream", () => {
  test("frames every chunk and reads a clean verdict", async () => {
    const clamd = await fakeClamd();

    try {
      const verdict = await scanStream(
        Readable.from([Buffer.from("hello "), Buffer.from("world")]),
        { host: "127.0.0.1", port: clamd.port },
      );

      expect(verdict).toEqual({ status: "CLEAN" });
      expect(clamd.seen()).toBe("hello world");
    } finally {
      clamd.close();
    }
  });

  test("reports what the scanner found", async () => {
    const clamd = await fakeClamd();

    try {
      const verdict = await scanStream(
        Readable.from([Buffer.from("xx MALWARE xx")]),
        { host: "127.0.0.1", port: clamd.port },
      );

      expect(verdict).toEqual({ status: "INFECTED", signature: "Test.Marker" });
    } finally {
      clamd.close();
    }
  });

  test("an unreachable scanner is an error, not a pass", async () => {
    await expect(
      scanStream(Readable.from([Buffer.from("x")]), {
        host: "127.0.0.1",
        port: 1,
        timeoutMs: 2000,
      }),
    ).rejects.toThrow();
  });
});
