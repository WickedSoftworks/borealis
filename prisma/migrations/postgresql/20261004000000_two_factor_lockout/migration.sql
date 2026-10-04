-- AlterTable
ALTER TABLE "TwoFactor" ADD COLUMN     "failedVerificationCount" INTEGER DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);
