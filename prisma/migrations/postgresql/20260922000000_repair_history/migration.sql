-- The PostgreSQL history drifted from the schema: the Invite table was only
-- ever migrated on SQLite, and the File.checksum index was never migrated on
-- either. A fresh Postgres instance therefore failed every account creation,
-- because the sign-up gate queries a table that did not exist.
--
-- Guarded with IF NOT EXISTS so an operator who already created the table by
-- hand (`prisma db push`, or pasting the SQL) can still apply this cleanly.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Invite" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "grantsRole" TEXT NOT NULL DEFAULT 'user',
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "redeemedById" TEXT,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Invite_codeHash_key" ON "Invite"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Invite_redeemedById_key" ON "Invite"("redeemedById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invite_createdById_idx" ON "Invite"("createdById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "File_checksum_idx" ON "File"("checksum");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Invite" ADD CONSTRAINT "Invite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Invite" ADD CONSTRAINT "Invite_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
