import { describe, expect, test } from "bun:test";
import { decide } from "./rate-limit";

const rule = { window: 60, max: 3 };
const t0 = 1_000_000;

describe("decide", () => {
  test("a first request opens a window", () => {
    expect(decide(null, rule, t0)).toEqual({
      decision: { allowed: true, remaining: 2 },
      next: { count: 1, lastRequest: BigInt(t0) },
    });
  });

  test("counts within the window without moving its start", () => {
    const { decision, next } = decide(
      { count: 1, lastRequest: BigInt(t0) },
      rule,
      t0 + 5_000,
    );

    expect(decision).toEqual({ allowed: true, remaining: 1 });
    expect(next).toEqual({ count: 2, lastRequest: BigInt(t0) });
  });

  test("refuses once the window is spent, saying when to come back", () => {
    expect(
      decide({ count: 3, lastRequest: BigInt(t0) }, rule, t0 + 20_000),
    ).toEqual({
      decision: { allowed: false, retryAfterSeconds: 40 },
      next: null,
    });
  });

  test("a spent window reopens once it has fully elapsed", () => {
    const { decision } = decide(
      { count: 3, lastRequest: BigInt(t0) },
      rule,
      t0 + 60_000,
    );

    expect(decision.allowed).toBe(true);
  });

  test("never tells a client to retry in zero seconds", () => {
    const { decision } = decide(
      { count: 3, lastRequest: BigInt(t0) },
      rule,
      t0 + 59_999,
    );

    expect(decision).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });
});
