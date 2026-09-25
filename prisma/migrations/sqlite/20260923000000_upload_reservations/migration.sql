CREATE TABLE "UploadReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bytes" BIGINT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT NOT NULL,
    "shareId" TEXT,
    CONSTRAINT "UploadReservation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UploadReservation_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "Share" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "UploadReservation_ownerId_expiresAt_idx" ON "UploadReservation"("ownerId", "expiresAt");
CREATE INDEX "UploadReservation_shareId_expiresAt_idx" ON "UploadReservation"("shareId", "expiresAt");
CREATE INDEX "UploadReservation_expiresAt_idx" ON "UploadReservation"("expiresAt");

CREATE TABLE "ShareTransfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservedBytes" BIGINT NOT NULL,
    "countDownload" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "shareId" TEXT NOT NULL,
    CONSTRAINT "ShareTransfer_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "Share" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ShareTransfer_updatedAt_idx" ON "ShareTransfer"("updatedAt");
