-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Share" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SEND',
    "name" TEXT,
    "description" TEXT,
    "passwordHash" TEXT,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "maxDownloads" INTEGER,
    "downloadCount" REAL NOT NULL DEFAULT 0,
    "egressLimitBytes" BIGINT,
    "egressUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "viewOnly" BOOLEAN NOT NULL DEFAULT false,
    "isE2E" BOOLEAN NOT NULL DEFAULT false,
    "notifyOnDownload" BOOLEAN NOT NULL DEFAULT false,
    "notifyEmail" TEXT,
    "allowedIps" TEXT,
    "maxUploadBytes" BIGINT,
    "maxUploadFiles" INTEGER,
    "requireUploader" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "Share_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Share" ("allowedIps", "createdAt", "description", "downloadCount", "egressLimitBytes", "egressUsedBytes", "expiresAt", "id", "isE2E", "maxDownloads", "maxUploadBytes", "maxUploadFiles", "name", "notifyEmail", "notifyOnDownload", "ownerId", "passwordHash", "requireUploader", "revokedAt", "token", "type", "updatedAt", "viewOnly") SELECT "allowedIps", "createdAt", "description", "downloadCount", "egressLimitBytes", "egressUsedBytes", "expiresAt", "id", "isE2E", "maxDownloads", "maxUploadBytes", "maxUploadFiles", "name", "notifyEmail", "notifyOnDownload", "ownerId", "passwordHash", "requireUploader", "revokedAt", "token", "type", "updatedAt", "viewOnly" FROM "Share";
DROP TABLE "Share";
ALTER TABLE "new_Share" RENAME TO "Share";
CREATE UNIQUE INDEX "Share_token_key" ON "Share"("token");
CREATE INDEX "Share_ownerId_idx" ON "Share"("ownerId");
CREATE INDEX "Share_expiresAt_idx" ON "Share"("expiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

