import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { hashInviteCode } from "@/lib/invites";
import { createUser, type Instance, iso, startInstance } from "./harness";

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
