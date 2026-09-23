import { describe, expect, test } from "bun:test";
import {
  describeWait,
  FREE_ATTEMPTS,
  LOCKOUT_WINDOW_MS,
  lockoutDelay,
  MAX_DELAY_MS,
  unlockLockout,
} from "./lockout";

const now = new Date("2026-09-22T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const seconds = (n: number) => n * 1000;
const minutes = (n: number) => n * 60 * 1000;

describe("lockoutDelay", () => {
  test("the first few mistakes cost nothing", () => {
    for (let failures = 0; failures < FREE_ATTEMPTS; failures++) {
      expect(lockoutDelay(failures)).toBe(0);
    }
  });

  test("doubles from a minute, to a ceiling", () => {
    expect(lockoutDelay(5)).toBe(minutes(1));
    expect(lockoutDelay(6)).toBe(minutes(2));
    expect(lockoutDelay(8)).toBe(minutes(8));
    expect(lockoutDelay(9)).toBe(MAX_DELAY_MS);
    expect(lockoutDelay(500)).toBe(MAX_DELAY_MS);
  });
});

describe("unlockLockout", () => {
  test("four recent failures do not lock", () => {
    const failures = [1, 2, 3, 4].map((n) => ago(seconds(n)));
    expect(unlockLockout(failures, now)).toEqual({ locked: false });
  });

  test("the fifth locks for a minute from the latest failure", () => {
    const failures = [10, 20, 30, 40, 50].map((n) => ago(seconds(n)));
    expect(unlockLockout(failures, now)).toEqual({
      locked: true,
      retryAfterMs: minutes(1) - seconds(10),
    });
  });

  test("the lock lifts once the wait has passed", () => {
    const failures = [2, 3, 4, 5, 6].map((n) => ago(minutes(n)));
    expect(unlockLockout(failures, now)).toEqual({ locked: false });
  });

  test("failures older than the window are forgotten", () => {
    const failures = [1, 2, 3, 4, 5].map((n) =>
      ago(LOCKOUT_WINDOW_MS + seconds(n)),
    );
    expect(unlockLockout(failures, now)).toEqual({ locked: false });
  });

  test("order does not matter", () => {
    const failures = [50, 10, 40, 20, 30].map((n) => ago(seconds(n)));
    expect(unlockLockout(failures, now).locked).toBe(true);
  });

  test("a failure dated in the future cannot extend the lock", () => {
    const failures = [
      ...[1, 2, 3, 4].map((n) => ago(minutes(n + 10))),
      new Date(now.getTime() + minutes(30)),
    ];
    expect(unlockLockout(failures, now)).toEqual({ locked: false });
  });
});

describe("describeWait", () => {
  test("rounds up, so the recipient never retries a moment too early", () => {
    expect(describeWait(seconds(1))).toBe("1 second");
    expect(describeWait(seconds(45) + 1)).toBe("46 seconds");
    expect(describeWait(seconds(61))).toBe("2 minutes");
    expect(describeWait(minutes(1))).toBe("1 minute");
  });
});
