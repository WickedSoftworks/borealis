import { describe, expect, test } from "bun:test";
import {
  formatDuration,
  formatRate,
  remainingSeconds,
  sampleSpeed,
  startSpeed,
  uploadErrorMessage,
} from "./transfer";

describe("speed", () => {
  test("no rate, and so no estimate, from a single sample", () => {
    const state = startSpeed(0);
    expect(remainingSeconds(state, 0, 1000)).toBeNull();
  });

  test("a steady transfer converges on its real rate", () => {
    let state = startSpeed(0);

    for (let second = 1; second <= 20; second++) {
      state = sampleSpeed(state, second * 1_000_000, second * 1000);
    }

    expect(state.rate).toBeCloseTo(1_000_000, -3);
    expect(remainingSeconds(state, 20_000_000, 30_000_000)).toBeCloseTo(10, 0);
  });

  test("a burst does not swing the estimate wildly", () => {
    let state = startSpeed(0);
    state = sampleSpeed(state, 1_000_000, 1000);
    state = sampleSpeed(state, 11_000_000, 2000); // one 10 MB burst

    // Smoothed: well under the 10 MB/s the burst alone would claim.
    expect(state.rate ?? 0).toBeLessThan(5_000_000);
  });

  test("samples closer than a quarter second are ignored", () => {
    const state = startSpeed(0);
    expect(sampleSpeed(state, 500, 100)).toBe(state);
  });
});

describe("formatting", () => {
  test("rates and durations read like a person would say them", () => {
    expect(formatRate(512)).toBe("512 B/s");
    expect(formatRate(1.5 * 1024 * 1024)).toBe("1.5 MB/s");
    expect(formatDuration(0.2)).toBe("a moment");
    expect(formatDuration(42.1)).toBe("43 s");
    expect(formatDuration(125)).toBe("2 min 5 s");
    expect(formatDuration(3 * 3600 + 120)).toBe("3 h 2 min");
  });
});

describe("uploadErrorMessage", () => {
  const withResponse = (status: number, body: string) => ({
    message: "tus: unexpected response while creating upload",
    originalResponse: { getStatus: () => status, getBody: () => body },
  });

  test("the server's own reason wins", () => {
    expect(
      uploadErrorMessage(
        withResponse(413, "This file is 3 GB and your account has 1 GB left."),
      ),
    ).toBe("This file is 3 GB and your account has 1 GB left.");
  });

  test("a bodiless 401 explains itself", () => {
    expect(uploadErrorMessage(withResponse(401, ""))).toContain("signed out");
  });

  test("a network failure keeps its message, minus the library prefix", () => {
    expect(uploadErrorMessage({ message: "tus: failed to upload chunk" })).toBe(
      "failed to upload chunk",
    );
  });
});
