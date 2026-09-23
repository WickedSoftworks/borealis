-- AlterTable
ALTER TABLE "User" ADD COLUMN "storageQuotaBytes" BIGINT;
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN DEFAULT false;

-- AlterTable
ALTER TABLE "File" ADD COLUMN "scanDetail" TEXT;
ALTER TABLE "File" ADD COLUMN "scanStatus" TEXT;
ALTER TABLE "File" ADD COLUMN "thumbnailKey" TEXT;

-- AlterTable
ALTER TABLE "Share" ADD COLUMN "allowedIps" TEXT;

-- CreateTable
CREATE TABLE "TwoFactor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "userId" TEXT NOT NULL,
    CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "detail" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Lease" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "holder" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "TwoFactor_secret_idx" ON "TwoFactor"("secret");

-- CreateIndex
CREATE INDEX "TwoFactor_userId_idx" ON "TwoFactor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");
