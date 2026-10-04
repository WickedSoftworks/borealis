-- AlterTable
ALTER TABLE "TwoFactor" ADD COLUMN "failedVerificationCount" INTEGER DEFAULT 0;
ALTER TABLE "TwoFactor" ADD COLUMN "lockedUntil" DATETIME;
