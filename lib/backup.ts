import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { acquireLease, BACKUP_LEASE, releaseLease } from "@/lib/lease";
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
 *
 * Consistent as a whole, not only the database. VACUUM INTO gives a sound
 * snapshot, but the files were copied afterwards from a store that kept
 * changing, and a file purged in between left the snapshot with a row and no
 * bytes — a backup that looked fine and restored broken. Now the backup holds
 * BACKUP_LEASE, which the trash purge waits on, and once the copy is done it
 * checks every file the snapshot lists against what was copied. A backup
 * missing any says so in its manifest (`complete: false`, and which).
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
  /**
   * Every file the snapshot lists has its bytes here, at the recorded size.
   * Absent on backups made before it was checked; false means `missing`
   * names what is not.
   */
  complete?: boolean;
  missing?: string[];
};

/** Long enough for a large copy between renewals; a dead backup frees it. */
const LEASE_MS = 30 * 60 * 1000;
const RENEW_EVERY = 200;
/** How many missing keys the manifest names; the count is always exact. */
const MISSING_LISTED = 100;

type Referenced = { storageKey: string; size: bigint | number };

/**
 * The stored objects the snapshot's File rows point at — read from the
 * snapshot itself, not the live database, which has moved on since.
 */
async function snapshotReferences(snapshot: string): Promise<Referenced[]> {
  const escaped = snapshot.replace(/'/g, "''");
  await db.$executeRawUnsafe(`ATTACH DATABASE '${escaped}' AS snapshot`);

  try {
    return await db.$queryRawUnsafe<Referenced[]>(
      `SELECT "storageKey", "size" FROM snapshot."File"`,
    );
  } finally {
    await db.$executeRawUnsafe("DETACH DATABASE snapshot");
  }
}

function sqlitePath(): string {
  return path.resolve((process.env.DATABASE_URL ?? "").replace(/^file:/, ""));
}

function storageDir(): string {
  return path.resolve(process.env.STORAGE_PATH ?? "./uploads");
}

export async function createBackup(target: string): Promise<Manifest> {
  // Taken before the snapshot, so nothing the snapshot lists is purged
  // between it and the copy.
  if (!(await acquireLease(BACKUP_LEASE, LEASE_MS))) {
    throw new Error("Another backup is running. Wait for it to finish.");
  }

  try {
    return await writeBackup(target);
  } finally {
    await releaseLease(BACKUP_LEASE);
  }
}

async function writeBackup(target: string): Promise<Manifest> {
  const provider =
    process.env.DATABASE_PROVIDER === "postgresql" ? "postgresql" : "sqlite";
  const storageDriver = process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";

  // The parent may be new; the backup directory itself must be, so a second
  // run can never write into — and half-overwrite — an earlier backup.
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.mkdir(target);

  const notes: string[] = [];
  let database: Manifest["database"] = "not-included";

  let referenced: Referenced[] | null = null;

  if (provider === "sqlite") {
    // VACUUM INTO writes a consistent copy while the server keeps running —
    // unlike copying the file, which can catch a write half-applied.
    const snapshot = path.join(target, "borealis.db");
    await db.$executeRawUnsafe(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    database = "included";
    referenced = await snapshotReferences(snapshot);
  } else {
    notes.push(
      "The database is PostgreSQL; back it up with pg_dump, e.g. `pg_dump -Fc -f borealis.dump $DATABASE_URL`.",
    );
  }

  let objects = 0;
  let bytes = 0;
  let files: Manifest["files"] = "not-included";
  let missing: string[] | undefined;

  if (storageDriver === "local") {
    const source = storageDir();
    const destination = path.join(target, "files");
    await fs.mkdir(destination);

    const copied = new Map<string, number>();

    for (const name of await fs.readdir(source)) {
      // Only what Borealis wrote. STORAGE_PATH may hold other things.
      if (classifyKey(name).kind === "foreign") continue;

      const from = path.join(source, name);
      // Gone since the listing — a finished upload's sidecar, an expired
      // partial. If it mattered, the check below will say so.
      const stat = await fs.stat(from).catch(() => null);
      if (!stat?.isFile()) continue;

      const copiedOk = await fs
        .copyFile(from, path.join(destination, name))
        .then(
          () => true,
          () => false,
        );
      if (!copiedOk) continue;

      copied.set(name, stat.size);
      objects++;
      bytes += stat.size;

      if (objects % RENEW_EVERY === 0) {
        await acquireLease(BACKUP_LEASE, LEASE_MS);
      }
    }

    files = "included";

    if (referenced) {
      missing = referenced
        .filter((row) => copied.get(row.storageKey) !== Number(row.size))
        .map((row) => row.storageKey);
    }
  } else {
    notes.push(
      "Files live in S3; protect them with bucket versioning or replication. Only the database is in this backup.",
    );
  }

  if (missing && missing.length > 0) {
    notes.push(
      `${missing.length} file(s) the database snapshot lists are missing or a different size here — deleted or changed while the backup ran. Restoring this backup would leave those rows without their bytes; run the backup again.`,
    );
  }

  const manifest: Manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    provider,
    storageDriver,
    database,
    files,
    // From the snapshot when there is one: the live count has moved on.
    fileRows: referenced?.length ?? (await db.file.count()),
    objects,
    bytes,
    notes,
    ...(missing && {
      complete: missing.length === 0,
      missing: missing.slice(0, MISSING_LISTED),
    }),
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
 * rather than clobbering newer bytes. One already present at a different
 * size is reported, not silently counted as restored, and a copy that fails
 * for any other reason — permissions, a full disk — is a failure, not a skip.
 */
export async function restoreBackup(source: string): Promise<{
  database: boolean;
  objects: number;
  skipped: number;
  differing: string[];
  failed: string[];
}> {
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
  const differing: string[] = [];
  const failed: string[] = [];

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
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          failed.push(`${name}: ${(error as Error).message}`);
          continue;
        }

        const [backedUp, present] = await Promise.all([
          fs.stat(path.join(from, name)),
          fs.stat(path.join(to, name)),
        ]);

        if (backedUp.size === present.size) skipped++;
        else differing.push(name);
      }
    }
  }

  return { database, objects, skipped, differing, failed };
}
