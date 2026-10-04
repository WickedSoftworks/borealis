import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import { hashInviteCode } from "@/lib/invites";
import {
  createFile,
  createShare,
  createUser,
  eventually,
  type Instance,
  iso,
  startInstance,
} from "./harness";

/*
  The authority and byte boundaries, asked of the real server: who may sign
  in, who may act as whom, and what an upload URL opens. Each test is the
  regression for a finding in the October 2026 code audit.
*/

const PASSWORD = "integration-only-password-0123";

let app: Instance;
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
  // Limits on, because one of these tests is about a limit. Everything else
  // plays a fresh address per request so the per-address ones stay clear.
  app = await startInstance({ RATE_LIMIT: "on" });
}, 90_000);

afterAll(async () => {
  await app?.stop();
});

let lastOctet = 0;

/** A different client address each call; TRUST_PROXY=1 believes it. */
function freshAddress(): string {
  lastOctet = (lastOctet % 250) + 1;
  return `198.51.100.${lastOctet}`;
}

/** A user with an email-and-password credential. */
function credentialUser(role = "user", id?: string) {
  const user = createUser(app, { role, ...(id ? { id } : {}) });
  const now = iso(new Date());

  app.db
    .query(
      `INSERT INTO "Account" (id, accountId, providerId, userId, password, createdAt, updatedAt)
       VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
    )
    .run(randomUUID(), user.id, user.id, passwordHash, now, now);

  return { ...user, email: `${user.id}@example.test` };
}

function postAuth(
  endpoint: string,
  body: unknown,
  { cookie = "", address = freshAddress() } = {},
) {
  return fetch(`${app.base}/api/auth/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: app.base,
      cookie,
      "x-forwarded-for": address,
    },
    body: JSON.stringify(body),
  });
}

function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

async function signIn(user: { email: string }): Promise<string> {
  const response = await postAuth("sign-in/email", {
    email: user.email,
    password: PASSWORD,
  });

  expect(response.status).toBe(200);
  return cookieFrom(response);
}

function role(userId: string): string | null {
  return (
    app.db.query(`SELECT role FROM "User" WHERE id = ?`).get(userId) as {
      role: string | null;
    }
  ).role;
}

describe("signing in", () => {
  test("a password sign-in and 2FA enrolment work on the migrated schema", async () => {
    // better-auth refuses every request when its tables lack a column it
    // expects; the last time that happened nothing else in the suite noticed.
    const user = credentialUser();
    const cookie = await signIn(user);

    const enable = await postAuth(
      "two-factor/enable",
      { password: PASSWORD },
      { cookie },
    );

    expect(enable.status).toBe(200);
    expect((await enable.json()).totpURI).toStartWith("otpauth://");
  });

  test("one account gets ten password guesses per window, whatever address they come from", async () => {
    const user = credentialUser();

    for (let guess = 0; guess < 10; guess++) {
      const response = await postAuth("sign-in/email", {
        email: user.email,
        password: `wrong-${guess}`,
      });
      expect(response.status).toBe(401);
    }

    // Even the right password, from yet another address, waits now.
    const refused = await postAuth("sign-in/email", {
      email: user.email.toUpperCase(),
      password: PASSWORD,
    });

    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("better-auth's admin endpoints", () => {
  test("are not reachable, so an admin cannot climb past the hierarchy", async () => {
    const root = createUser(app, { id: "0", role: "root" });
    const admin = credentialUser("admin");
    const peer = credentialUser("admin");
    const cookie = await signIn(admin);

    for (const [endpoint, body] of [
      ["admin/set-role", { userId: admin.id, role: "root" }],
      ["admin/impersonate-user", { userId: root.id }],
      ["admin/ban-user", { userId: peer.id }],
      [
        "admin/set-user-password",
        { userId: peer.id, newPassword: "x".repeat(12) },
      ],
      ["admin/remove-user", { userId: peer.id }],
    ] as const) {
      const response = await postAuth(endpoint, body, { cookie });
      expect(`${endpoint} ${response.status}`).toBe(`${endpoint} 404`);
    }

    expect(role(admin.id)).toBe("admin");
    expect(
      app.db.query(`SELECT banned FROM "User" WHERE id = ?`).get(peer.id),
    ).toEqual({ banned: 0 });
  });
});

describe("invitations", () => {
  test("one code makes one account, however many sign-ups race for it", async () => {
    const code = `RACE-${randomUUID()}`;

    app.db
      .query(
        `INSERT INTO "Invite" (id, codeHash, grantsRole) VALUES (?, ?, 'admin')`,
      )
      .run(randomUUID(), hashInviteCode(code));

    const tag = randomUUID().slice(0, 8);
    const responses = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) =>
        postAuth(
          "sign-up/email",
          {
            email: `race-${tag}-${n}@example.test`,
            name: `Race ${n}`,
            password: PASSWORD,
          },
          { cookie: `borealis_invite=${encodeURIComponent(code)}` },
        ),
      ),
    );

    expect(responses.filter((response) => response.ok)).toHaveLength(1);
    expect(
      app.db
        .query(`SELECT COUNT(*) AS n FROM "User" WHERE email LIKE ?`)
        .get(`race-${tag}-%`),
    ).toEqual({ n: 1 });
  });
});

describe("tus upload URLs", () => {
  const TUS = { "tus-resumable": "1.0.0" };

  function metadata(fields: Record<string, string>): string {
    return Object.entries(fields)
      .map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`)
      .join(",");
  }

  function start(
    mount: string,
    size: number,
    fields: Record<string, string>,
    cookie = "",
  ) {
    return fetch(`${app.base}${mount}`, {
      method: "POST",
      headers: {
        ...TUS,
        cookie,
        "upload-length": String(size),
        "upload-metadata": metadata(fields),
        "x-forwarded-for": freshAddress(),
      },
    });
  }

  async function create(
    mount: string,
    size: number,
    fields: Record<string, string>,
    cookie = "",
  ): Promise<string> {
    const response = await start(mount, size, fields, cookie);

    expect(response.status).toBe(201);
    return new URL(response.headers.get("location") ?? "", app.base).pathname;
  }

  function patch(url: string, offset: number, bytes: string, cookie = "") {
    return fetch(`${app.base}${url}`, {
      method: "PATCH",
      headers: {
        ...TUS,
        cookie,
        "content-type": "application/offset+octet-stream",
        "upload-offset": String(offset),
        "x-forwarded-for": freshAddress(),
      },
      body: bytes,
    });
  }

  function call(method: string, url: string, cookie = "") {
    return fetch(`${app.base}${url}`, {
      method,
      headers: { ...TUS, cookie },
    });
  }

  test("an upload answers to its own account only, and never serves bytes", async () => {
    const owner = credentialUser();
    const other = credentialUser();
    const ownerCookie = await signIn(owner);
    const otherCookie = await signIn(other);

    const url = await create(
      "/api/upload",
      10,
      { filename: "half.txt", filetype: "text/plain" },
      ownerCookie,
    );
    expect((await patch(url, 0, "hello", ownerCookie)).status).toBe(204);

    // Someone else signed in: not theirs to resume, inspect, finish, or cancel.
    expect((await call("HEAD", url, otherCookie)).status).toBe(404);
    expect((await patch(url, 5, "world", otherCookie)).status).toBe(404);
    expect((await call("DELETE", url, otherCookie)).status).toBe(404);

    const finished = await patch(url, 5, "world", ownerCookie);
    expect(finished.status).toBe(204);
    const fileId = finished.headers.get("x-file-id");
    expect(
      app.db.query(`SELECT ownerId FROM "File" WHERE id = ?`).get(fileId),
    ).toEqual({ ownerId: owner.id });

    // Finished, it is a file: no raw bytes and no deleting it through tus.
    expect((await call("GET", url, ownerCookie)).status).toBe(405);
    expect((await call("DELETE", url, ownerCookie)).status).toBe(400);
  });

  test("the anonymous mount reaches nothing but its own unfinished uploads", async () => {
    const owner = createUser(app);
    const file = createFile(app, {
      ownerId: owner.id,
      body: Buffer.from("private"),
      scanStatus: "INFECTED",
    });
    const raw = `/api/reverse-upload/${file.storageKey}`;

    expect((await call("GET", raw)).status).toBe(405);
    expect((await call("HEAD", raw)).status).toBe(404);
    expect((await call("DELETE", raw)).status).toBe(404);
    expect(
      fs.readFileSync(path.join(app.storage, file.storageKey), "utf8"),
    ).toBe("private");
  });

  test("a collection upload stops when its link closes, and stays once it lands", async () => {
    const owner = createUser(app);
    const share = createShare(app, { ownerId: owner.id, type: "REVERSE" });
    const fields = {
      token: share.token,
      filename: "sent.txt",
      filetype: "text/plain",
    };

    const landed = await create("/api/reverse-upload", 4, fields);
    expect((await patch(landed, 0, "done")).status).toBe(204);
    expect((await call("GET", landed)).status).toBe(405);
    expect((await call("DELETE", landed)).status).toBe(400);

    const inFlight = await create("/api/reverse-upload", 10, fields);
    expect((await patch(inFlight, 0, "hello")).status).toBe(204);

    app.db
      .query(`UPDATE "Share" SET revokedAt = ? WHERE id = ?`)
      .run(iso(new Date()), share.id);

    expect((await patch(inFlight, 5, "world")).status).toBe(403);
    expect((await call("HEAD", inFlight)).status).toBe(403);
  });

  test("uploads still in flight count against the quota, and cancelling gives it back", async () => {
    const owner = credentialUser();
    const cookie = await signIn(owner);
    app.db
      .query(`UPDATE "User" SET storageQuotaBytes = 10 WHERE id = ?`)
      .run(owner.id);
    const fields = {
      filename: "big.bin",
      filetype: "application/octet-stream",
    };

    // Started, not finished: nothing has landed, but six bytes are promised.
    const first = await create("/api/upload", 6, fields, cookie);
    expect((await start("/api/upload", 6, fields, cookie)).status).toBe(413);

    expect((await call("DELETE", first, cookie)).status).toBe(204);
    await eventually("the cancelled upload's space to come back", () => {
      return (
        (
          app.db
            .query(
              `SELECT COUNT(*) AS n FROM "UploadReservation" WHERE ownerId = ?`,
            )
            .get(owner.id) as { n: number }
        ).n === 0
      );
    });
    expect((await start("/api/upload", 6, fields, cookie)).status).toBe(201);
  });

  test("a collection link's file limit counts uploads on their way", async () => {
    const owner = createUser(app);
    const share = createShare(app, { ownerId: owner.id, type: "REVERSE" });
    app.db
      .query(`UPDATE "Share" SET maxUploadFiles = 1 WHERE id = ?`)
      .run(share.id);
    const fields = {
      token: share.token,
      filename: "one.txt",
      filetype: "text/plain",
    };

    const only = await create("/api/reverse-upload", 3, fields);
    expect((await start("/api/reverse-upload", 3, fields)).status).toBe(403);

    expect((await patch(only, 0, "one")).status).toBe(204);
    expect((await start("/api/reverse-upload", 3, fields)).status).toBe(403);
  });
});
