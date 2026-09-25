CREATE TABLE "UploadReservation" (
    "id" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT NOT NULL,
    "shareId" TEXT,

    CONSTRAINT "UploadReservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UploadReservation_ownerId_expiresAt_idx" ON "UploadReservation"("ownerId", "expiresAt");
CREATE INDEX "UploadReservation_shareId_expiresAt_idx" ON "UploadReservation"("shareId", "expiresAt");
CREATE INDEX "UploadReservation_expiresAt_idx" ON "UploadReservation"("expiresAt");

ALTER TABLE "UploadReservation" ADD CONSTRAINT "UploadReservation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UploadReservation" ADD CONSTRAINT "UploadReservation_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "Share"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ShareTransfer" (
    "id" TEXT NOT NULL,
    "reservedBytes" BIGINT NOT NULL,
    "countDownload" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "shareId" TEXT NOT NULL,

    CONSTRAINT "ShareTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShareTransfer_updatedAt_idx" ON "ShareTransfer"("updatedAt");
ALTER TABLE "ShareTransfer" ADD CONSTRAINT "ShareTransfer_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "Share"("id") ON DELETE CASCADE ON UPDATE CASCADE;
