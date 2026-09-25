import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  snapshotFiles,
  verifyRestoreCollisions,
  verifySnapshotObjects,
} from "./backup";

test("saved database references must exist in the copied objects", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "borealis-backup-test-"),
  );
  try {
    const databasePath = path.join(directory, "borealis.db");
    const objects = path.join(directory, "files");
    await fs.mkdir(objects);

    const key = "owner_fixture";
    const bytes = Buffer.from("hello");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const sqlite = new Database(databasePath);
    sqlite.exec(
      'CREATE TABLE "File" (storageKey TEXT, thumbnailKey TEXT, size INTEGER, checksum TEXT)',
    );
    sqlite
      .query("INSERT INTO File VALUES (?, ?, ?, ?)")
      .run(key, null, bytes.length, checksum);
    sqlite.close();

    const rows = await snapshotFiles(databasePath);
    expect(rows).toHaveLength(1);
    await expect(verifySnapshotObjects(rows, objects)).rejects.toThrow(
      `missing referenced object ${key}`,
    );

    await fs.writeFile(path.join(objects, key), bytes);
    await verifySnapshotObjects(rows, objects);

    await fs.writeFile(path.join(objects, key), "tampered");
    await expect(verifySnapshotObjects(rows, objects)).rejects.toThrow(
      "wrong size",
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("restore refuses an existing object with different bytes", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "borealis-restore-test-"),
  );
  try {
    const saved = path.join(directory, "saved");
    const live = path.join(directory, "live");
    await fs.mkdir(saved);
    await fs.mkdir(live);
    const key = "reverse_12345678-1234-1234-1234-123456789abc";
    await fs.writeFile(path.join(saved, key), "correct");
    await fs.writeFile(path.join(live, key), "wrong!!");
    await expect(verifyRestoreCollisions(saved, live)).rejects.toThrow(
      `conflicting object ${key}`,
    );
    await fs.writeFile(path.join(live, key), "correct");
    await verifyRestoreCollisions(saved, live);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
