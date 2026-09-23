import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashSharePassword } from "@/lib/shares/password";
import {
  createFile,
  createShare,
  createUser,
  eventually,
  type Instance,
  startInstance,
} from "./harness";

/*
  What a recipient can and cannot get out of a share link, asked of the real
  server. Every refusal here is one the roadmap found missing or broken at
  some point; each test is the regression that keeps it fixed.
*/

let app: Instance;
let owner: { id: string };

beforeAll(async () => {
  app = await startInstance();
  owner = createUser(app);
}, 90_000);

afterAll(async () => {
  await app?.stop();
});

function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${app.base}${path}`, { headers, redirect: "manual" });
}

function downloads(shareId: string): number {
  return (
    app.db
      .query(`SELECT downloadCount FROM "Share" WHERE id = ?`)
      .get(shareId) as { downloadCount: number }
  ).downloadCount;
}

describe("serving a share", () => {
  test("a file in the share comes back byte for byte, as an attachment, sandboxed", async () => {
    const file = createFile(app, { ownerId: owner.id });
    const share = createShare(app, { ownerId: owner.id, fileIds: [file.id] });

    const response = await get(`/api/s/${share.token}/download/${file.id}`);

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString("hex")).toBe(
      file.body.toString("hex"),
    );
    expect(response.headers.get("content-disposition")).toStartWith(
      "attachment",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );

    // Counted after the body is sent (Next's `after`), so give it a moment.
    await eventually(
      "the download to be counted",
      () => downloads(share.id) === 1,
    );
  });

  test("a file outside the share is not reachable through it", async () => {
    const inside = createFile(app, { ownerId: owner.id });
    const outside = createFile(app, { ownerId: owner.id });
    const share = createShare(app, { ownerId: owner.id, fileIds: [inside.id] });

    const response = await get(`/api/s/${share.token}/download/${outside.id}`);
    expect(response.status).toBe(404);
  });

  test("a collection link's token opens nothing on the send routes", async () => {
    const file = createFile(app, { ownerId: owner.id });
    const reverse = createShare(app, {
      ownerId: owner.id,
      type: "REVERSE",
      fileIds: [file.id],
    });

    expect(
      (await get(`/api/s/${reverse.token}/download/${file.id}`)).status,
    ).toBe(404);
    expect((await get(`/s/${reverse.token}`)).status).toBe(404);
  });

  test("revoked and expired links refuse, with different answers", async () => {
    const file = createFile(app, { ownerId: owner.id });
    const revoked = createShare(app, {
      ownerId: owner.id,
      fileIds: [file.id],
      revokedAt: new Date(),
    });
    const expired = createShare(app, {
      ownerId: owner.id,
      fileIds: [file.id],
      createdAt: new Date(Date.now() - 2 * 86_400_000),
      expiresAt: new Date(Date.now() - 60_000),
    });

    expect(
      (await get(`/api/s/${revoked.token}/download/${file.id}`)).status,
    ).toBe(404);
    expect(
      (await get(`/api/s/${expired.token}/download/${file.id}`)).status,
    ).toBe(410);
  });

  test("a download cap closes the link once it is spent", async () => {
    const file = createFile(app, { ownerId: owner.id });
    const share = createShare(app, {
      ownerId: owner.id,
      fileIds: [file.id],
      maxDownloads: 1,
    });

    const first = await get(`/api/s/${share.token}/download/${file.id}`);
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    await eventually(
      "the download to be counted",
      () => downloads(share.id) === 1,
    );

    expect(
      (await get(`/api/s/${share.token}/download/${file.id}`)).status,
    ).toBe(410);
  });

  test("a range request is served as a slice and is not a download", async () => {
    const file = createFile(app, {
      ownerId: owner.id,
      body: Buffer.from("0123456789abcdef"),
    });
    const share = createShare(app, {
      ownerId: owner.id,
      fileIds: [file.id],
      maxDownloads: 1,
    });

    const response = await get(`/api/s/${share.token}/download/${file.id}`, {
      Range: "bytes=4-7",
    });

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("4567");
    expect(response.headers.get("content-range")).toBe("bytes 4-7/16");

    // Give the accounting its chance to run, then check it did not count.
    await Bun.sleep(500);
    expect(downloads(share.id)).toBe(0);
  });

  test("a file the scanner flagged is withheld", async () => {
    const file = createFile(app, { ownerId: owner.id, scanStatus: "INFECTED" });
    const share = createShare(app, { ownerId: owner.id, fileIds: [file.id] });

    expect(
      (await get(`/api/s/${share.token}/download/${file.id}`)).status,
    ).toBe(404);
  });

  test("an allow list admits its network and refuses others", async () => {
    const file = createFile(app, { ownerId: owner.id });
    const share = createShare(app, {
      ownerId: owner.id,
      fileIds: [file.id],
      allowedIps: "198.51.100.0/24",
    });
    const url = `/api/s/${share.token}/download/${file.id}`;

    expect((await get(url, { "X-Forwarded-For": "203.0.113.9" })).status).toBe(
      403,
    );
    expect((await get(url, { "X-Forwarded-For": "198.51.100.7" })).status).toBe(
      200,
    );
  });

  test("“get all” is one ZIP of exactly the advertised length, counted once", async () => {
    const a = createFile(app, { ownerId: owner.id, name: "a.txt" });
    const b = createFile(app, { ownerId: owner.id, name: "b.txt" });
    const share = createShare(app, {
      ownerId: owner.id,
      fileIds: [a.id, b.id],
    });

    const response = await get(`/api/s/${share.token}/archive`);
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(Number(response.headers.get("content-length"))).toBe(body.length);
    expect(body.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    await eventually("the archive to count as one download", () =>
      downloads(share.id) === 1 ? true : null,
    );
  });

  test("the share page carries a content security policy", async () => {
    const file = createFile(app, { ownerId: owner.id });
    const share = createShare(app, { ownerId: owner.id, fileIds: [file.id] });

    const response = await get(`/s/${share.token}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });
});

describe("password-protected shares", () => {
  async function unlock(token: string, password: string) {
    return fetch(`${app.base}/api/s/${token}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  }

  function failures(shareId: string): number {
    return (
      app.db
        .query(
          `SELECT COUNT(*) AS n FROM "ShareAccess" WHERE shareId = ? AND action = 'UNLOCK_FAIL'`,
        )
        .get(shareId) as { n: number }
    ).n;
  }

  test("no bytes without the password; the right one opens it", async () => {
    const file = createFile(app, { ownerId: owner.id });
    const share = createShare(app, {
      ownerId: owner.id,
      fileIds: [file.id],
      passwordHash: await hashSharePassword("correct horse"),
    });
    const url = `/api/s/${share.token}/download/${file.id}`;

    expect((await get(url)).status).toBe(401);

    const wrong = await unlock(share.token, "wrong");
    expect(wrong.status).toBe(401);
    expect(failures(share.id)).toBe(1);

    const right = await unlock(share.token, "correct horse");
    expect(right.status).toBe(200);

    const cookie = right.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();

    const opened = await get(url, { Cookie: cookie as string });
    expect(opened.status).toBe(200);
    expect(Buffer.from(await opened.arrayBuffer()).toString("hex")).toBe(
      file.body.toString("hex"),
    );
  });

  test("repeated wrong guesses lock the link, even against the right password", async () => {
    const file = createFile(app, { ownerId: owner.id });
    const share = createShare(app, {
      ownerId: owner.id,
      fileIds: [file.id],
      passwordHash: await hashSharePassword("correct horse"),
    });

    // Five free attempts (lib/shares/lockout.ts), then the lock.
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await unlock(share.token, `guess ${attempt}`)).status).toBe(401);
    }

    const locked = await unlock(share.token, "correct horse");
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);

    // Attempts made while locked are not checked, so they are not recorded.
    expect(failures(share.id)).toBe(5);
  });
});

describe("operations endpoints", () => {
  test("health answers; metrics are hidden without their token", async () => {
    expect((await get("/api/health")).status).toBe(200);
    expect((await get("/api/metrics")).status).toBe(404);
  });
});
