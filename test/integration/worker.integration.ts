import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scannedPdf, textImage } from "@/lib/testing/fixtures";
import {
  createFile,
  createShare,
  createUser,
  enqueueJob,
  eventually,
  type Instance,
  iso,
  startInstance,
} from "./harness";

/*
  The background worker, running inside the production server as it does in
  the container. Jobs are inserted into the queue directly and their effects
  read back from the database and the upload directory.
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

function jobStatus(id: string): string | undefined {
  return (
    app.db.query(`SELECT status FROM "Job" WHERE id = ?`).get(id) as
      | { status: string }
      | undefined
  )?.status;
}

function exists(key: string): boolean {
  return fs.existsSync(path.join(app.storage, key));
}

/** A tus upload as the local store leaves it: data file plus JSON sidecar. */
function tusUpload(
  key: string,
  {
    declared,
    received,
    ageHours,
  }: { declared: number; received: number; ageHours: number },
) {
  fs.writeFileSync(path.join(app.storage, key), Buffer.alloc(received, 1));
  fs.writeFileSync(
    path.join(app.storage, `${key}.json`),
    JSON.stringify({
      id: key,
      size: declared,
      // tus's FileStore writes offset 0 here and never updates it — which is
      // exactly what fooled its own expiry into deleting finished uploads.
      offset: 0,
      creation_date: new Date(Date.now() - ageHours * 3_600_000).toISOString(),
    }),
  );
}

describe("the hourly sweep", () => {
  test(
    "revokes expired links, purges old trash, and keeps everything else",
    async () => {
      const file = createFile(app, { ownerId: owner.id });
      const expired = createShare(app, {
        ownerId: owner.id,
        fileIds: [file.id],
        createdAt: new Date(Date.now() - 3 * 86_400_000),
        expiresAt: new Date(Date.now() - 60_000),
      });
      const live = createShare(app, {
        ownerId: owner.id,
        fileIds: [file.id],
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      const oldTrash = createFile(app, {
        ownerId: owner.id,
        deletedAt: new Date(Date.now() - 60 * 86_400_000),
      });
      const recentTrash = createFile(app, {
        ownerId: owner.id,
        deletedAt: new Date(Date.now() - 60_000),
      });

      const sweep = enqueueJob(app, "EXPIRE_SWEEP");
      await eventually(
        "the sweep to finish",
        () => jobStatus(sweep.id) === "DONE",
      );

      const revoked = (id: string) =>
        (
          app.db
            .query(`SELECT revokedAt FROM "Share" WHERE id = ?`)
            .get(id) as {
            revokedAt: string | null;
          }
        ).revokedAt;

      expect(revoked(expired.id)).not.toBeNull();
      expect(revoked(live.id)).toBeNull();

      // The sweep queues the purge; the purge removes row and bytes.
      await eventually(
        "old trash to be purged",
        () =>
          !app.db
            .query(`SELECT id FROM "File" WHERE id = ?`)
            .get(oldTrash.id) && !exists(oldTrash.storageKey),
      );

      expect(
        app.db.query(`SELECT id FROM "File" WHERE id = ?`).get(recentTrash.id),
      ).toBeTruthy();
      expect(exists(recentTrash.storageKey)).toBe(true);
      expect(exists(file.storageKey)).toBe(true);
    },
    { timeout: 60_000 },
  );

  test(
    "removes an abandoned upload, never a finished file a row points at",
    async () => {
      // A finished upload, two days old, whose sidecar still claims offset 0.
      // This is the file tus's own expiry deleted from a real vault.
      const finishedKey = `${owner.id}_${randomUUID()}`;
      tusUpload(finishedKey, { declared: 64, received: 64, ageHours: 48 });
      const now = iso(new Date());
      app.db
        .query(
          `INSERT INTO "File" (id, storageKey, originalName, mimeType, size, ownerId, createdAt, updatedAt)
           VALUES (?, ?, 'kept.bin', 'application/octet-stream', 64, ?, ?, ?)`,
        )
        .run(`f${randomUUID().slice(0, 12)}`, finishedKey, owner.id, now, now);

      // Recorded, even though the bytes on disk are short of what was
      // declared: a row is the final word, whatever the sidecar says.
      const recordedShortKey = `${owner.id}_${randomUUID()}`;
      tusUpload(recordedShortKey, { declared: 64, received: 10, ageHours: 48 });
      app.db
        .query(
          `INSERT INTO "File" (id, storageKey, originalName, mimeType, size, ownerId, createdAt, updatedAt)
           VALUES (?, ?, 'short.bin', 'application/octet-stream', 64, ?, ?, ?)`,
        )
        .run(
          `f${randomUUID().slice(0, 12)}`,
          recordedShortKey,
          owner.id,
          now,
          now,
        );

      // Abandoned: no row, half the bytes, past the window.
      const abandonedKey = `${owner.id}_${randomUUID()}`;
      tusUpload(abandonedKey, { declared: 64, received: 20, ageHours: 48 });

      // In progress: no row yet, half the bytes, but only an hour old.
      const inFlightKey = `${owner.id}_${randomUUID()}`;
      tusUpload(inFlightKey, { declared: 64, received: 20, ageHours: 1 });

      // Not ours: a file in the directory that Borealis did not name.
      fs.writeFileSync(path.join(app.storage, "operator-notes.json"), "{}");

      const sweep = enqueueJob(app, "EXPIRE_SWEEP");
      await eventually(
        "the sweep to finish",
        () => jobStatus(sweep.id) === "DONE",
      );

      expect(exists(finishedKey)).toBe(true);
      expect(exists(recordedShortKey)).toBe(true);
      expect(exists(inFlightKey)).toBe(true);
      expect(exists("operator-notes.json")).toBe(true);

      expect(exists(abandonedKey)).toBe(false);
      expect(exists(`${abandonedKey}.json`)).toBe(false);
    },
    { timeout: 60_000 },
  );
});

describe("text extraction and OCR", () => {
  function fileText(fileId: string) {
    return app.db
      .query(`SELECT status, content, error FROM "FileText" WHERE fileId = ?`)
      .get(fileId) as {
      status: string;
      content: string;
      error: string | null;
    } | null;
  }

  test(
    "a text file is indexed on its own; an image goes through OCR",
    async () => {
      const text = createFile(app, {
        ownerId: owner.id,
        body: Buffer.from("the lighthouse keeper's ledger"),
      });
      const image = createFile(app, {
        ownerId: owner.id,
        name: "receipt.png",
        mimeType: "image/png",
        body: await textImage(["Receipt 55120", "Harbour chandlery"]),
      });
      const scan = createFile(app, {
        ownerId: owner.id,
        name: "letter.pdf",
        mimeType: "application/pdf",
        body: await scannedPdf(
          await textImage(["Dear tenant", "Reference 90871"]),
        ),
      });

      for (const file of [text, image, scan]) {
        enqueueJob(app, "EXTRACT_TEXT", { fileId: file.id });
      }

      const done = (id: string) => {
        const row = fileText(id);
        return row?.status === "DONE" ? row : null;
      };

      expect(
        (await eventually("text indexed", () => done(text.id))).content,
      ).toContain("lighthouse");

      // Proof, too, that the build traced tesseract's worker, cores, and
      // model into the standalone output — this runs in that output.
      const ocrImage = await eventually(
        "image OCR",
        () => done(image.id),
        60_000,
      );
      expect(ocrImage.content).toContain("55120");

      const ocrScan = await eventually("scan OCR", () => done(scan.id), 60_000);
      expect(ocrScan.content).toContain("90871");
    },
    { timeout: 120_000 },
  );

  test(
    "with OCR off, an image is skipped and says why",
    async () => {
      const off = await startInstance({ OCR: "off" });

      try {
        const user = createUser(off);
        const image = createFile(off, {
          ownerId: user.id,
          name: "receipt.png",
          mimeType: "image/png",
          body: await textImage(["Receipt 55120"]),
        });
        enqueueJob(off, "EXTRACT_TEXT", { fileId: image.id });

        const row = await eventually(
          "the skip to be recorded",
          () =>
            off.db
              .query(`SELECT status, error FROM "FileText" WHERE fileId = ?`)
              .get(image.id) as { status: string; error: string } | null,
        );

        expect(row.status).toBe("SKIPPED");
        expect(row.error).toContain("OCR is turned off");
      } finally {
        await off.stop();
      }
    },
    { timeout: 120_000 },
  );
});
