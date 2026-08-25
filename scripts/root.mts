/**
 * Root account console.
 *
 * Root (user id "0") is seeded without any credential, so it cannot be signed
 * into from the web at all until someone with shell access on the box sets a
 * password here. That is the point: control of the instance follows control of
 * the server, not knowledge of a URL.
 *
 *   bun run root seed                 create the root account if missing
 *   bun run root set-password         set root's password (prompts)
 *   bun run root passwd <email>       reset any account's password (prompts)
 *   bun run root disable-login        remove root's credential again
 *   bun run root invite [--admin]     mint an invitation code
 *   bun run root status               show accounts and outstanding invites
 *   bun run root checksum             queue hashing for files missing one
 *
 * Runs under Node, not Bun: the SQLite driver adapter has no Bun support yet.
 */

import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  generateInviteCode,
  hashInviteCode,
  ROLE_ADMIN,
  ROLE_ROOT,
  ROLE_USER,
  ROOT_USER_ID,
} from "@/lib/invites";

const [command, ...args] = process.argv.slice(2);

async function ensureRoot() {
  const existing = await db.user.findUnique({ where: { id: ROOT_USER_ID } });

  if (existing) return existing;

  return db.user.create({
    data: {
      id: ROOT_USER_ID,
      name: "root",
      // Never deliverable. Root does not receive mail; it exists to be an
      // authority, not a mailbox.
      email: "root@borealis.local",
      emailVerified: true,
      role: ROLE_ROOT,
    },
  });
}

async function prompt(question: string) {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

switch (command) {
  case "seed": {
    const root = await ensureRoot();
    console.log(
      `root account present (id ${root.id}, no login until you set a password)`,
    );
    break;
  }

  // `set-password` with no argument targets root; with an email it resets any
  // account. This is the only recovery path — there is no emailed reset link,
  // because a self-hosted instance may have no SMTP configured at all.
  case "set-password":
  case "passwd": {
    const email = args[0];

    const target = email
      ? await db.user.findFirst({ where: { email } })
      : await ensureRoot();

    if (!target) {
      console.error(`No account with the email ${email}`);
      process.exit(1);
    }

    const password = await prompt(`New password for ${target.email}: `);

    if (password.length < 12) {
      console.error("Refusing: the password must be at least 12 characters.");
      process.exit(1);
    }

    const ctx = await auth.$context;
    const hash = await ctx.password.hash(password);

    const account = await db.account.findFirst({
      where: { userId: target.id, providerId: "credential" },
    });

    if (account) {
      await db.account.update({
        where: { id: account.id },
        data: { password: hash },
      });
    } else {
      await db.account.create({
        data: {
          id: crypto.randomUUID(),
          accountId: target.id,
          providerId: "credential",
          userId: target.id,
          password: hash,
        },
      });
    }

    console.log(`${target.email} can now sign in with that password.`);
    break;
  }

  case "disable-login": {
    const removed = await db.account.deleteMany({
      where: { userId: ROOT_USER_ID, providerId: "credential" },
    });

    console.log(
      removed.count > 0
        ? "root's password removed; web sign-in is closed again"
        : "root had no password set",
    );
    break;
  }

  case "invite": {
    await ensureRoot();

    const grantsRole = args.includes("--admin") ? ROLE_ADMIN : ROLE_USER;
    const code = generateInviteCode();

    await db.invite.create({
      data: {
        codeHash: hashInviteCode(code),
        grantsRole,
        note: "minted from the console",
        createdById: ROOT_USER_ID,
      },
    });

    console.log(`\n  ${code}\n`);
    console.log(`Single use. Creates a "${grantsRole}" account. Shown once.`);
    break;
  }

  case "checksum": {
    // Backfill for rows that predate the CHECKSUM job. Enqueues rather than
    // hashing here so the work runs through the worker's retry and logging
    // path instead of a second, unsupervised loop. Re-running is safe: the job
    // returns early on any file that already has a digest.
    const files = await db.file.findMany({
      where: { checksum: null, deletedAt: null },
      select: { id: true },
    });

    if (files.length === 0) {
      console.log("every file already has a checksum.");
      break;
    }

    await db.job.createMany({
      data: files.map((file) => ({
        type: "CHECKSUM",
        payload: JSON.stringify({ fileId: file.id }),
      })),
    });

    console.log(`queued ${files.length} file(s); the worker will hash them.`);
    break;
  }

  case "status": {
    const users = await db.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });
    const open = await db.invite.count({
      where: { redeemedAt: null, revokedAt: null },
    });

    console.log(`accounts (${users.length}):`);
    for (const user of users) {
      console.log(`  ${(user.role ?? "user").padEnd(6)} ${user.email}`);
    }
    console.log(`\noutstanding invitations: ${open}`);
    break;
  }

  default:
    console.log(
      [
        "usage: bun run root <command>",
        "",
        "  seed              create the root account if missing",
        "  set-password      set root's password (prompts)",
        "  passwd <email>    reset any account's password (prompts)",
        "  disable-login     remove root's credential again",
        "  invite [--admin]  mint a single-use invitation code",
        "  status            list accounts and outstanding invitations",
        "  checksum          queue hashing for files missing a checksum",
      ].join("\n"),
    );
    process.exit(command ? 1 : 0);
}

process.exit(0);
