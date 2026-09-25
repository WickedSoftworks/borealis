import { describe, expect, test } from "bun:test";
import { quotaVerdict } from "./quota";

const GB = 1024n ** 3n;

const base = {
  size: 1n * GB,
  account: { used: 0n, trash: 0n, reserved: 0n, limit: null },
  instanceUsed: 0n,
  instanceCeiling: null,
  maxUpload: null,
};

describe("quotaVerdict", () => {
  test("no ceilings configured means no refusal, whatever the size", () => {
    expect(quotaVerdict({ ...base, size: 10_000n * GB })).toBeNull();
  });

  test("a file exactly at the per-file limit is allowed", () => {
    expect(quotaVerdict({ ...base, maxUpload: 1n * GB })).toBeNull();
  });

  test("one byte over the per-file limit is refused", () => {
    expect(
      quotaVerdict({ ...base, size: GB + 1n, maxUpload: GB })?.reason,
    ).toBe("FILE_TOO_LARGE");
  });

  test("filling an account exactly is allowed; past it is not", () => {
    const account = { used: 4n * GB, trash: 0n, reserved: 0n, limit: 5n * GB };

    expect(quotaVerdict({ ...base, account })).toBeNull();
    expect(quotaVerdict({ ...base, size: GB + 1n, account })?.reason).toBe(
      "ACCOUNT_FULL",
    );
  });

  test("incomplete uploads occupy account capacity", () => {
    expect(
      quotaVerdict({
        ...base,
        account: {
          used: 0n,
          trash: 0n,
          reserved: 4n * GB,
          limit: 5n * GB,
        },
        size: 2n * GB,
      })?.reason,
    ).toBe("ACCOUNT_FULL");
  });

  test("an account refusal names what is left and points at the trash", () => {
    const refusal = quotaVerdict({
      ...base,
      size: 2n * GB,
      account: { used: 4n * GB, trash: 3n * GB, reserved: 0n, limit: 5n * GB },
    });

    expect(refusal?.message).toContain("1.0 GB left of its 5.0 GB");
    expect(refusal?.message).toContain("Emptying the trash would free 3.0 GB");
  });

  test("an account already over its limit reports nothing left, not a negative", () => {
    const refusal = quotaVerdict({
      ...base,
      account: { used: 6n * GB, trash: 0n, reserved: 0n, limit: 5n * GB },
    });

    expect(refusal?.message).toContain("0 B left");
  });

  test("the instance ceiling applies after the account's", () => {
    expect(
      quotaVerdict({
        ...base,
        instanceUsed: 99n * GB + 1n,
        instanceCeiling: 100n * GB,
      })?.reason,
    ).toBe("INSTANCE_FULL");
  });

  test("the per-file limit is reported first when several apply", () => {
    expect(
      quotaVerdict({
        ...base,
        size: 3n * GB,
        maxUpload: GB,
        account: { used: 0n, trash: 0n, reserved: 0n, limit: GB },
        instanceCeiling: GB,
      })?.reason,
    ).toBe("FILE_TOO_LARGE");
  });
});
