import { Database } from "bun:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Integration tests run against the production build — `.next/standalone`,
 * the thing the container ships — over HTTP, with a throwaway database and
 * upload directory per instance.
 *
 * Black-box on purpose. Route handlers lean on Next's request scope (`after`,
 * `cookies`) and the SQLite adapter is a native Node module that Bun cannot
 * load, so calling handlers in-process would test a harness, not the app.
 * Over HTTP the proxy, the headers, the worker, and the build's file tracing
 * are all exercised as deployed. Fixtures go straight into the database with
 * bun:sqlite.
 *
 * The build runs from a copy outside the project, as it does in the
 * container. Run in place, Node's module resolution falls back from the
 * standalone node_modules to the project's own whenever the trace missed a
 * file — which hid tesseract's real cores and sharp's libvips until the
 * container, with nothing to fall back to, failed on both.
 *
 * Nothing here may ever reach real data. The standalone build copies the
 * project's `.env` next to server.js and would load it; the copy leaves it
 * out, every key it held is overridden anyway — with a test value or an empty
 * string, which Next's loader never replaces — and the database and upload
 * paths are checked to be inside the temp directory before anything is
 * written.
 */

const ROOT = path.resolve(import.meta.dir, "..", "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");
const SERVER = path.join(STANDALONE, "server.js");
const MIGRATIONS = path.join(ROOT, "prisma", "migrations", "sqlite");
const TEMP_PREFIX = "borealis-it-";

export type Instance = {
  base: string;
  db: Database;
  storage: string;
  /** Everything the server printed, for a failing test's message. */
  output: () => string;
  stop: () => Promise<void>;
};

/** How Prisma's SQLite adapter writes a DateTime, so rows read back alike. */
export function iso(date: Date): string {
  return date.toISOString().replace("Z", "+00:00");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

let isolatedBuild: string | null = null;

/**
 * The standalone build, copied once per run to a temp directory, minus `.env`.
 *
 * Turbopack's output holds symlinks for external packages
 * (`.next/node_modules/sharp-<hash>`) whose targets are absolute paths into
 * the project's node_modules. In the container those same paths land on the
 * traced copy at /app/node_modules, because the build ran at /app too. Here
 * each is recreated pointing into the copy's own node_modules, which is that
 * same arrangement — following them instead would load the project's full
 * packages and hide exactly what this is for.
 */
function isolatedStandalone(): string {
  if (isolatedBuild) return isolatedBuild;

  const target = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `${TEMP_PREFIX}build-`)),
  );
  const projectModules = path.join(ROOT, "node_modules");
  const links: Array<{ link: string; to: string }> = [];

  fs.cpSync(STANDALONE, target, {
    recursive: true,
    filter: (source, destination) => {
      if (path.relative(STANDALONE, source) === ".env") return false;

      if (fs.lstatSync(source).isSymbolicLink()) {
        const pointsAt = path.resolve(
          path.dirname(source),
          fs.readlinkSync(source),
        );
        const inProject = path.relative(projectModules, pointsAt);

        if (inProject.startsWith("..") || path.isAbsolute(inProject)) {
          throw new Error(
            `standalone link ${source} points outside node_modules: ${pointsAt}`,
          );
        }

        links.push({
          link: destination,
          to: path.join(target, "node_modules", inProject),
        });
        return false;
      }

      return true;
    },
  });

  for (const { link, to } of links) {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    // A junction needs no privilege on Windows; elsewhere a plain link.
    fs.symlinkSync(to, link, process.platform === "win32" ? "junction" : "dir");
  }

  process.on("exit", () => {
    fs.rmSync(target, { recursive: true, force: true });
  });

  isolatedBuild = target;
  return target;
}

function insideTemp(target: string): boolean {
  const relative = path.relative(fs.realpathSync(os.tmpdir()), target);
  return (
    !relative.startsWith("..") &&
    !path.isAbsolute(relative) &&
    relative.startsWith(TEMP_PREFIX)
  );
}

/** Keys the standalone `.env` would otherwise supply to the server. */
function envFileKeys(): string[] {
  const file = path.join(STANDALONE, ".env");
  if (!fs.existsSync(file)) return [];

  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]);
}

export async function startInstance(
  extraEnv: Record<string, string> = {},
): Promise<Instance> {
  if (!fs.existsSync(SERVER)) {
    throw new Error(
      "No production build. Run `bun run build` first — integration tests run against .next/standalone.",
    );
  }

  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX)),
  );
  const dbFile = path.join(dir, "test.db");
  const storage = path.join(dir, "uploads");

  if (!insideTemp(dbFile) || !insideTemp(storage)) {
    throw new Error(`refusing to use ${dir}: not a harness temp directory`);
  }

  fs.mkdirSync(storage);

  const db = new Database(dbFile);
  // The server writes to this file too (the worker, the download counter);
  // wait for its lock rather than failing the fixture that collided with it.
  db.exec("PRAGMA busy_timeout = 10000");
  for (const migration of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d/.test(name))
    .sort()) {
    db.exec(
      fs.readFileSync(
        path.join(MIGRATIONS, migration, "migration.sql"),
        "utf8",
      ),
    );
  }

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  const env: Record<string, string> = {};

  // What a process needs to run at all, and nothing of the caller's config.
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "SystemDrive",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
  ]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }

  for (const key of envFileKeys()) env[key] = "";

  Object.assign(env, {
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    DATABASE_PROVIDER: "sqlite",
    DATABASE_URL: `file:${dbFile}`,
    STORAGE_DRIVER: "local",
    STORAGE_PATH: storage,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    BETTER_AUTH_URL: base,
    // One hop: the test sets X-Forwarded-For to play a client at an address.
    TRUST_PROXY: "1",
    // The per-address limits would trip across a suite's worth of requests
    // from one address; the per-share unlock lockout is not a rate limit and
    // stays on.
    RATE_LIMIT: "off",
    LOG_FORMAT: "json",
    LOG_LEVEL: "info",
    ...extraEnv,
  });

  const build = isolatedStandalone();

  const child = Bun.spawn(["node", path.join(build, "server.js")], {
    cwd: build,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    (async () => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        output += decoder.decode(value);
      }
    })();
  }

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) break;
    } catch {
      // Not listening yet.
    }

    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill();
      throw new Error(`server did not start:\n${output}`);
    }

    await Bun.sleep(250);
  }

  return {
    base,
    db,
    storage,
    output: () => output,
    async stop() {
      child.kill();
      await child.exited;
      db.close();
      if (insideTemp(dbFile)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** Poll until `check` returns something truthy, or fail with `what`. */
export async function eventually<T>(
  what: string,
  check: () => T | null | undefined | false,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(200);
  }
}

// ---- Fixtures -------------------------------------------------------------

export function createUser(
  instance: Instance,
  { id = `u${randomUUID().slice(0, 8)}`, role = "user" } = {},
) {
  const now = iso(new Date());

  instance.db
    .query(
      `INSERT INTO "User" (id, name, email, emailVerified, role, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(id, `Test ${id}`, `${id}@example.test`, role, now, now);

  return { id };
}

export function createFile(
  instance: Instance,
  {
    ownerId,
    name = "notes.txt",
    mimeType = "text/plain",
    body = Buffer.from("hello from the vault\n"),
    scanStatus = null as string | null,
    deletedAt = null as Date | null,
    storageKey = `${ownerId}_${randomUUID()}`,
  }: {
    ownerId: string;
    name?: string;
    mimeType?: string;
    body?: Buffer;
    scanStatus?: string | null;
    deletedAt?: Date | null;
    storageKey?: string;
  },
) {
  const id = `f${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = iso(new Date());

  fs.writeFileSync(path.join(instance.storage, storageKey), body);

  instance.db
    .query(
      `INSERT INTO "File" (id, storageKey, originalName, mimeType, size, ownerId, scanStatus, deletedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      storageKey,
      name,
      mimeType,
      body.length,
      ownerId,
      scanStatus,
      deletedAt ? iso(deletedAt) : null,
      now,
      now,
    );

  return { id, storageKey, body };
}

export function createShare(
  instance: Instance,
  {
    ownerId,
    fileIds = [] as string[],
    type = "SEND",
    passwordHash = null as string | null,
    expiresAt = null as Date | null,
    revokedAt = null as Date | null,
    maxDownloads = null as number | null,
    allowedIps = null as string | null,
    createdAt = new Date(),
  }: {
    ownerId: string;
    fileIds?: string[];
    type?: string;
    passwordHash?: string | null;
    expiresAt?: Date | null;
    revokedAt?: Date | null;
    maxDownloads?: number | null;
    allowedIps?: string | null;
    createdAt?: Date;
  },
) {
  const id = `s${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const token = randomBytes(16).toString("base64url");

  instance.db
    .query(
      `INSERT INTO "Share" (id, token, type, passwordHash, expiresAt, revokedAt, maxDownloads, allowedIps, ownerId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      token,
      type,
      passwordHash,
      expiresAt ? iso(expiresAt) : null,
      revokedAt ? iso(revokedAt) : null,
      maxDownloads,
      allowedIps,
      ownerId,
      iso(createdAt),
      iso(createdAt),
    );

  for (const fileId of fileIds) {
    instance.db
      .query(`INSERT INTO "ShareItem" (id, shareId, fileId) VALUES (?, ?, ?)`)
      .run(`i${randomUUID().slice(0, 12)}`, id, fileId);
  }

  return { id, token };
}

export function enqueueJob(
  instance: Instance,
  type: string,
  payload: Record<string, unknown> = {},
) {
  const id = `j${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = iso(new Date(Date.now() - 1000));

  instance.db
    .query(
      `INSERT INTO "Job" (id, type, payload, runAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, type, JSON.stringify(payload), now, now, now);

  return { id };
}
