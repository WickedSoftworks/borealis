import { describe, expect, test } from "bun:test";
import type { Share } from "@/lib/generated/prisma/client";
import { GUARD_STATUS, guardShare } from "./guard";
import { signUnlockToken, UNLOCK_TTL_MS } from "./password";

// signUnlockToken throws without it, and the guard verifies real HMACs rather
// than being handed a stub — the token binding is half of what is under test.
process.env.BETTER_AUTH_SECRET ??= "test-secret-not-used-outside-this-file";

const SHARE_ID = "share_1";
const PASSWORD_HASH = "scrypt$16384$8$1$aabb$ccdd";

const past = () => new Date(Date.now() - 60_000);
const future = () => new Date(Date.now() + 60_000);

/**
 * A share with every gate open. Each test opens exactly one gate's worth of
 * trouble, so a failure names the rule that broke rather than a soup of state.
 */
function makeShare(overrides: Partial<Share> = {}): Share {
  return {
    id: SHARE_ID,
    token: "tok_1",
    type: "SEND",
    name: null,
    description: null,
    passwordHash: null,
    expiresAt: null,
    revokedAt: null,
    maxDownloads: null,
    downloadCount: 0,
    egressLimitBytes: null,
    egressUsedBytes: 0n,
    viewOnly: false,
    isE2E: false,
    notifyOnDownload: false,
    notifyEmail: null,
    maxUploadBytes: null,
    maxUploadFiles: null,
    requireUploader: false,
    createdAt: past(),
    updatedAt: past(),
    ownerId: "user_1",
    ...overrides,
  };
}

/** A cookie value that genuinely clears the gate for this share + hash. */
function validToken(shareId = SHARE_ID, passwordHash = PASSWORD_HASH) {
  return signUnlockToken(shareId, passwordHash, Date.now() + UNLOCK_TTL_MS);
}

describe("guardShare — the open case", () => {
  test("a share with no limits passes, for metadata and for downloads", () => {
    expect(guardShare(makeShare())).toEqual({ ok: true });
    expect(guardShare(makeShare(), { isDownload: true })).toEqual({ ok: true });
  });

  test("a future expiry is not an expiry", () => {
    expect(guardShare(makeShare({ expiresAt: future() }))).toEqual({
      ok: true,
    });
  });
});

describe("guardShare — existence and lifecycle", () => {
  test("a missing share is NOT_FOUND", () => {
    expect(guardShare(null)).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  test("a revoked share is REVOKED", () => {
    expect(guardShare(makeShare({ revokedAt: past() }))).toEqual({
      ok: false,
      reason: "REVOKED",
    });
  });

  test("a past expiry is EXPIRED", () => {
    expect(guardShare(makeShare({ expiresAt: past() }))).toEqual({
      ok: false,
      reason: "EXPIRED",
    });
  });

  test("expiry is inclusive — expiring exactly now counts as expired", () => {
    // isExpired uses <=, so a share cannot be alive for the instant it dies.
    expect(guardShare(makeShare({ expiresAt: new Date() }))).toEqual({
      ok: false,
      reason: "EXPIRED",
    });
  });

  test("revocation outranks expiry", () => {
    // Both true. REVOKED wins because it is checked first, and both are 404 —
    // so neither distinguishes a dead share from one that never existed.
    expect(
      guardShare(makeShare({ revokedAt: past(), expiresAt: past() })),
    ).toEqual({ ok: false, reason: "REVOKED" });
  });
});

describe("guardShare — metadata requests ignore the download gates", () => {
  // The share page renders for a view-only or spent link: the recipient is owed
  // the reason it will not give them bytes. Only isDownload requests are gated.

  test("a view-only share still renders its page", () => {
    expect(guardShare(makeShare({ viewOnly: true }))).toEqual({ ok: true });
  });

  test("a share with no downloads left still renders its page", () => {
    expect(
      guardShare(makeShare({ maxDownloads: 1, downloadCount: 1 })),
    ).toEqual({ ok: true });
  });

  test("a share over its egress cap still renders its page", () => {
    expect(
      guardShare(makeShare({ egressLimitBytes: 100n, egressUsedBytes: 500n }), {
        bytes: 999n,
      }),
    ).toEqual({ ok: true });
  });
});

describe("guardShare — viewOnly", () => {
  test("refuses a download with VIEW_ONLY", () => {
    expect(
      guardShare(makeShare({ viewOnly: true }), { isDownload: true }),
    ).toEqual({ ok: false, reason: "VIEW_ONLY" });
  });
});

describe("guardShare — download limit", () => {
  test("passes while a download remains", () => {
    expect(
      guardShare(makeShare({ maxDownloads: 3, downloadCount: 2 }), {
        isDownload: true,
      }),
    ).toEqual({ ok: true });
  });

  test("refuses on the count reaching the cap", () => {
    // >= , not >. The third download of a max-3 share is the last one served.
    expect(
      guardShare(makeShare({ maxDownloads: 3, downloadCount: 3 }), {
        isDownload: true,
      }),
    ).toEqual({ ok: false, reason: "DOWNLOAD_LIMIT" });
  });

  test("refuses if the count somehow overshot the cap", () => {
    expect(
      guardShare(makeShare({ maxDownloads: 3, downloadCount: 9 }), {
        isDownload: true,
      }),
    ).toEqual({ ok: false, reason: "DOWNLOAD_LIMIT" });
  });

  test("a null cap is unlimited", () => {
    expect(
      guardShare(makeShare({ maxDownloads: null, downloadCount: 10_000 }), {
        isDownload: true,
      }),
    ).toEqual({ ok: true });
  });
});

describe("guardShare — egress limit", () => {
  test("projects the pending bytes, not just the bytes already spent", () => {
    // Used is under the cap; this one file would take it over. The point of a
    // pre-check is that it refuses BEFORE the bytes go out.
    expect(
      guardShare(makeShare({ egressLimitBytes: 100n, egressUsedBytes: 60n }), {
        isDownload: true,
        bytes: 41n,
      }),
    ).toEqual({ ok: false, reason: "EGRESS_LIMIT" });
  });

  test("landing exactly on the cap is allowed", () => {
    // > , not >=. Spending your last byte is spending, not overspending.
    expect(
      guardShare(makeShare({ egressLimitBytes: 100n, egressUsedBytes: 60n }), {
        isDownload: true,
        bytes: 40n,
      }),
    ).toEqual({ ok: true });
  });

  test("omitted bytes are treated as zero", () => {
    expect(
      guardShare(makeShare({ egressLimitBytes: 100n, egressUsedBytes: 100n }), {
        isDownload: true,
      }),
    ).toEqual({ ok: true });
  });

  test("refuses once already over the cap", () => {
    expect(
      guardShare(makeShare({ egressLimitBytes: 100n, egressUsedBytes: 101n }), {
        isDownload: true,
      }),
    ).toEqual({ ok: false, reason: "EGRESS_LIMIT" });
  });

  test("a null cap is unlimited", () => {
    expect(
      guardShare(makeShare({ egressLimitBytes: null }), {
        isDownload: true,
        bytes: 2n ** 40n,
      }),
    ).toEqual({ ok: true });
  });
});

describe("guardShare — the password gate", () => {
  const locked = () => makeShare({ passwordHash: PASSWORD_HASH });

  test("refuses with no token at all", () => {
    expect(guardShare(locked())).toEqual({
      ok: false,
      reason: "PASSWORD_REQUIRED",
    });
  });

  test("refuses a malformed token", () => {
    for (const token of ["", "garbage", "a.b", "a.b.c.d"]) {
      expect(guardShare(locked(), { unlockToken: token })).toEqual({
        ok: false,
        reason: "PASSWORD_REQUIRED",
      });
    }
  });

  test("accepts a token signed for this share and this hash", () => {
    expect(guardShare(locked(), { unlockToken: validToken() })).toEqual({
      ok: true,
    });
  });

  test("refuses a token minted for a different share", () => {
    // Otherwise one unlocked share would unlock every share on the instance.
    expect(
      guardShare(locked(), { unlockToken: validToken("share_2") }),
    ).toEqual({ ok: false, reason: "PASSWORD_REQUIRED" });
  });

  test("changing the password revokes every outstanding unlock", () => {
    // The README's claim, enforced here: the token is bound to the hash it was
    // issued against, so a rotated password invalidates old cookies with no
    // revocation list to maintain.
    const issuedUnderOldPassword = validToken(SHARE_ID, "scrypt$old$hash");

    expect(
      guardShare(locked(), { unlockToken: issuedUnderOldPassword }),
    ).toEqual({ ok: false, reason: "PASSWORD_REQUIRED" });
  });

  test("refuses an expired token", () => {
    const stale = signUnlockToken(SHARE_ID, PASSWORD_HASH, Date.now() - 1_000);

    expect(guardShare(locked(), { unlockToken: stale })).toEqual({
      ok: false,
      reason: "PASSWORD_REQUIRED",
    });
  });

  test("gates downloads as well as metadata", () => {
    expect(guardShare(locked(), { isDownload: true })).toEqual({
      ok: false,
      reason: "PASSWORD_REQUIRED",
    });

    expect(
      guardShare(locked(), { isDownload: true, unlockToken: validToken() }),
    ).toEqual({ ok: true });
  });
});

describe("guardShare — check order is the security property", () => {
  // The password check runs LAST. Every test here would pass a naive
  // implementation that checked the password first, and each one would then be
  // an oracle: a caller could learn whether a password is correct by watching
  // which refusal a dead share hands back.

  test("an expired share never becomes a password oracle", () => {
    const share = makeShare({ passwordHash: PASSWORD_HASH, expiresAt: past() });

    // Same answer with a correct password as with none. The share is gone; its
    // password is not a question anyone gets to ask.
    expect(guardShare(share)).toEqual({ ok: false, reason: "EXPIRED" });
    expect(guardShare(share, { unlockToken: validToken() })).toEqual({
      ok: false,
      reason: "EXPIRED",
    });
  });

  test("a revoked share never becomes a password oracle", () => {
    const share = makeShare({ passwordHash: PASSWORD_HASH, revokedAt: past() });

    expect(guardShare(share)).toEqual({ ok: false, reason: "REVOKED" });
    expect(guardShare(share, { unlockToken: validToken() })).toEqual({
      ok: false,
      reason: "REVOKED",
    });
  });

  test("an exhausted share never becomes a password oracle", () => {
    const share = makeShare({
      passwordHash: PASSWORD_HASH,
      maxDownloads: 1,
      downloadCount: 1,
    });

    expect(guardShare(share, { isDownload: true })).toEqual({
      ok: false,
      reason: "DOWNLOAD_LIMIT",
    });
  });

  test("a view-only share never becomes a password oracle", () => {
    const share = makeShare({ passwordHash: PASSWORD_HASH, viewOnly: true });

    expect(guardShare(share, { isDownload: true })).toEqual({
      ok: false,
      reason: "VIEW_ONLY",
    });
  });

  test("viewOnly outranks the download and egress caps", () => {
    // All three would refuse. The recipient should learn the durable fact about
    // the link, not the incidental one.
    const share = makeShare({
      viewOnly: true,
      maxDownloads: 1,
      downloadCount: 5,
      egressLimitBytes: 1n,
      egressUsedBytes: 900n,
    });

    expect(guardShare(share, { isDownload: true, bytes: 500n })).toEqual({
      ok: false,
      reason: "VIEW_ONLY",
    });
  });
});

describe("GUARD_STATUS", () => {
  test("a missing share and a revoked one are indistinguishable over HTTP", () => {
    // The anti-probing guarantee. If these ever diverge, a token becomes
    // testable for existence.
    expect(GUARD_STATUS.NOT_FOUND).toBe(404);
    expect(GUARD_STATUS.REVOKED).toBe(404);
  });

  test("every failure reason maps to a status", () => {
    const reasons = [
      "NOT_FOUND",
      "REVOKED",
      "EXPIRED",
      "DOWNLOAD_LIMIT",
      "EGRESS_LIMIT",
      "PASSWORD_REQUIRED",
      "VIEW_ONLY",
    ] as const;

    for (const reason of reasons) {
      expect(GUARD_STATUS[reason]).toBeGreaterThanOrEqual(400);
    }

    // No reason added to the union without a status decided for it.
    expect(Object.keys(GUARD_STATUS).sort()).toEqual([...reasons].sort());
  });
});
