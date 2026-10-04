-- CreateTable
CREATE TABLE "UploadReservation" (
    "id" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "shareId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UploadReservation_ownerId_idx" ON "UploadReservation"("ownerId");

-- CreateIndex
CREATE INDEX "UploadReservation_shareId_idx" ON "UploadReservation"("shareId");

-- CreateIndex
CREATE INDEX "UploadReservation_createdAt_idx" ON "UploadReservation"("createdAt");

-- AddForeignKey
ALTER TABLE "UploadReservation" ADD CONSTRAINT "UploadReservation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadReservation" ADD CONSTRAINT "UploadReservation_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "Share"("id") ON DELETE CASCADE ON UPDATE CASCADE;

