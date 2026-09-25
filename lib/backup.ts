import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { db } from "@/lib/db";
import { classifyKey } from "@/lib/reconcile";

/**
 * Backup and restore, for `bun run root backup` / `root restore`.
 *
 * A backup is a plain directory, on purpose — an operator can look inside it,
 * copy it with anything, and restore it by hand if this code is not there:
 *
 *   borealis-2026-09-22T20-15-03/
 *     manifest.json     what, when, and from which provider
 *     borealis.db       SQLite only: a consistent snapshot (VACUUM INTO)
 *     files/            local storage only: every object Borealis wrote
 *
 * Postgres and S3 are not copied here. Each has a better tool than this one —
 * `pg_dump`, bucket versioning or replication — and pretending otherwise
 * would give an operator a backup that is subtly incomplete. The manifest
 * says which parts were not included and why.
 */

export type Manifest = {
  version: 1;
  createdAt: string;
  provider: "sqlite" | "postgresql";
  storageDriver: "local" | "s3";
  database: "included" | "not-included";
  files: "included" | "not-included";
  fileRows: number;
  objects: number;
  bytes: number;
  notes: string[];
};

function sqlitePath(): string {
  return path.resolve((process.env.DATABASE_URL ?? "").replace(/^file:/, ""));
}

function storageDir(): string {
  return path.resolve(process.env.STORAGE_PATH ?? "./uploads");
}

type SnapshotFile = {
  storageKey: string;
  thumbnailKey: string | null;
  size: bigint | number;
  checksum: string | null;
};

/** Read the saved database, never the live one: rows may change during copy. */
export async function snapshotFiles(
  databasePath: string,
): Promise<SnapshotFile[]> {
  type SnapshotConnection = {
    prepare(sql: string): { all(): SnapshotFile[] };
    close(): void;
  };
  let snapshot: SnapshotConnection;
  if (typeof Bun !== "undefined") {
    const { Database } = await import("bun:sqlite");
    snapshot = new Database(databasePath, { readonly: true, create: false });
  } else {
    const SQLite = createRequire(import.meta.url)("better-sqlite3") as new (
      filename: string,
      options: { readonly: boolean; fileMustExist: boolean },
    ) => SnapshotConnection;
    snapshot = new SQLite(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
  }
  try {
    return snapshot
      .prepare('SELECT storageKey, thumbnailKey, size, checksum FROM "File"')
      .all();
  } finally {
    snapshot.close();
  }
}

export async function verifySnapshotObjects(
  rows: SnapshotFile[],
  directory: string,
): Promise<void> {
  for (const row of rows) {
    for (const key of [row.storageKey, row.thumbnailKey]) {
      if (!key) continue;
      if (path.basename(key) !== key) {
        throw new Error(`Invalid storage key in database snapshot: ${key}`);
      }
      const filename = path.join(directory, key);
      const stat = await fs.stat(filename).catch(() => null);
      if (!stat?.isFile()) {
        throw new Error(`Backup is missing referenced object ${key}`);
      }
      if (key === row.storageKey && BigInt(stat.size) !== BigInt(row.size)) {
        throw new Error(`Backup object ${key} has the wrong size`);
      }
      if (key === row.storageKey && row.checksum) {
        if ((await fileDigest(filename)) !== row.checksum) {
          throw new Error(`Backup object ${key} failed its checksum`);
        }
      }
    }
  }
}

async function fileDigest(filename: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

/** Existing objects are kept on restore, so reject any conflicting contents. */
export async function verifyRestoreCollisions(
  source: string,
  destination: string,
): Promise<void> {
  for (const name of await fs.readdir(source)) {
    const saved = path.join(source, name);
    const live = path.join(destination, name);
    const existing = await fs.stat(live).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (!existing) continue;
    const savedStat = await fs.stat(saved);
    if (
      !existing.isFile() ||
      !savedStat.isFile() ||
      existing.size !== savedStat.size ||
      (await fileDigest(live)) !== (await fileDigest(saved))
    ) {
      throw new Error(`Restore destination has conflicting object ${name}`);
    }
  }
}

export async function createBackup(target: string): Promise<Manifest> {
  const provider =
    process.env.DATABASE_PROVIDER === "postgresql" ? "postgresql" : "sqlite";
  const storageDriver = process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";

  // The parent may be new; the backup directory itself must be, so a second
  // run can never write into — and half-overwrite — an earlier backup.
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.mkdir(target);

  const notes: string[] = [];
  let database: Manifest["database"] = "not-included";

  if (provider === "sqlite") {
    // VACUUM INTO writes a consistent copy while the server keeps running —
    // unlike copying the file, which can catch a write half-applied.
    const out = path.join(target, "borealis.db").replace(/'/g, "''");
    await db.$executeRawUnsafe(`VACUUM INTO '${out}'`);
    database = "included";
  } else {
    notes.push(
      "The database is PostgreSQL; back it up with pg_dump, e.g. `pg_dump -Fc -f borealis.dump $DATABASE_URL`.",
    );
  }

  let objects = 0;
  let bytes = 0;
  let files: Manifest["files"] = "not-included";

  if (storageDriver === "local") {
    const source = storageDir();
    const destination = path.join(target, "files");
    await fs.mkdir(destination);

    for (const name of await fs.readdir(source)) {
      // Only what Borealis wrote. STORAGE_PATH may hold other things.
      if (classifyKey(name).kind === "foreign") continue;

      const from = path.join(source, name);
      const stat = await fs.stat(from);
      if (!stat.isFile()) continue;

      await fs.copyFile(from, path.join(destination, name));
      objects++;
      bytes += stat.size;
    }

    files = "included";
  } else {
    notes.push(
      "Files live in S3; protect them with bucket versioning or replication. Only the database is in this backup.",
    );
  }

  const savedRows =
    database === "included"
      ? await snapshotFiles(path.join(target, "borealis.db"))
      : null;
  if (savedRows && files === "included") {
    await verifySnapshotObjects(savedRows, path.join(target, "files"));
  }

  const manifest: Manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    provider,
    storageDriver,
    database,
    files,
    fileRows: savedRows?.length ?? (await db.file.count()),
    objects,
    bytes,
    notes,
  };

  await fs.writeFile(
    path.join(target, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return manifest;
}

export async function readManifest(source: string): Promise<Manifest> {
  const manifest = JSON.parse(
    await fs.readFile(path.join(source, "manifest.json"), "utf8"),
  ) as Manifest;

  if (manifest.version !== 1) {
    throw new Error(`Unknown backup format version ${manifest.version}.`);
  }

  return manifest;
}

/**
 * Put a backup back. The caller has stopped the server — the SQLite file is
 * replaced underneath whatever has it open otherwise — and has confirmed.
 *
 * Files are copied back without overwriting anything already present, so a
 * restore onto a volume that still has some of its objects fills the gaps
 * rather than clobbering newer bytes.
 */
export async function restoreBackup(
  source: string,
): Promise<{ database: boolean; objects: number; skipped: number }> {
  const manifest = await readManifest(source);
  let database = false;

  // Validate the saved database and its objects before replacing anything.
  if (manifest.database === "included") {
    const rows = await snapshotFiles(path.join(source, "borealis.db"));
    if (manifest.files === "included") {
      await verifySnapshotObjects(rows, path.join(source, "files"));
    }
  }
  if (manifest.files === "included") {
    await verifyRestoreCollisions(path.join(source, "files"), storageDir());
  }

  if (manifest.database === "included") {
    const provider =
      process.env.DATABASE_PROVIDER === "postgresql" ? "postgresql" : "sqlite";

    if (provider !== "sqlite") {
      throw new Error(
        "This backup holds a SQLite database, but DATABASE_PROVIDER is postgresql.",
      );
    }

    await db.$disconnect();

    const live = sqlitePath();

    // The old file is kept beside the new one, not deleted: a restore that
    // turns out to be the wrong backup should itself be undoable.
    try {
      await fs.rename(live, `${live}.before-restore-${Date.now()}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const suffix of ["-wal", "-shm"]) {
      await fs.rm(`${live}${suffix}`, { force: true });
    }

    await fs.copyFile(path.join(source, "borealis.db"), live);
    database = true;
  }

  let objects = 0;
  let skipped = 0;

  if (manifest.files === "included") {
    const from = path.join(source, "files");
    const to = storageDir();
    await fs.mkdir(to, { recursive: true });

    for (const name of await fs.readdir(from)) {
      try {
        await fs.copyFile(
          path.join(from, name),
          path.join(to, name),
          fs.constants.COPYFILE_EXCL,
        );
        objects++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          skipped++;
        } else {
          throw new Error(`Could not restore object ${name}`, { cause: error });
        }
      }
    }
  }

  return { database, objects, skipped };
}
