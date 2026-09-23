import fs from "node:fs/promises";
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

  const manifest: Manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    provider,
    storageDriver,
    database,
    files,
    fileRows: await db.file.count(),
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
    await fs
      .rename(live, `${live}.before-restore-${Date.now()}`)
      .catch(() => {});
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
      } catch {
        skipped++;
      }
    }
  }

  return { database, objects, skipped };
}
