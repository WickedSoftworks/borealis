import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyInteraction } from "./verify";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
// The raw 32 bytes, hex, the way the Developer Portal shows the key.
const publicHex = publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");

const now = 1_800_000_000_000;
const timestamp = String(now / 1000);
const body = JSON.stringify({ type: 1 });

function signed(text: string, at = timestamp) {
  return sign(null, Buffer.from(at + text), privateKey).toString("hex");
}

describe("verifyInteraction", () => {
  test("accepts what the key signed", () => {
    expect(
      verifyInteraction({
        publicKey: publicHex,
        signature: signed(body),
        timestamp,
        body,
        now,
      }),
    ).toBe(true);
  });

  test("refuses a body changed after signing", () => {
    expect(
      verifyInteraction({
        publicKey: publicHex,
        signature: signed(body),
        timestamp,
        body: JSON.stringify({ type: 2 }),
        now,
      }),
    ).toBe(false);
  });

  test("refuses another key's signature", () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    const signature = sign(null, Buffer.from(timestamp + body), other).toString(
      "hex",
    );

    expect(
      verifyInteraction({
        publicKey: publicHex,
        signature,
        timestamp,
        body,
        now,
      }),
    ).toBe(false);
  });

  test("refuses a stale timestamp, even correctly signed", () => {
    const old = String(now / 1000 - 600);
    expect(
      verifyInteraction({
        publicKey: publicHex,
        signature: signed(body, old),
        timestamp: old,
        body,
        now,
      }),
    ).toBe(false);
  });

  test("refuses missing or malformed headers without throwing", () => {
    for (const signature of [null, "", "zz", "00".repeat(64)]) {
      expect(
        verifyInteraction({
          publicKey: publicHex,
          signature,
          timestamp,
          body,
          now,
        }),
      ).toBe(false);
    }
    expect(
      verifyInteraction({
        publicKey: "not-hex",
        signature: signed(body),
        timestamp,
        body,
        now,
      }),
    ).toBe(false);
  });
});
