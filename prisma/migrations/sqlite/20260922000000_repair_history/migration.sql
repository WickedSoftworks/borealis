-- The File.checksum index was added to the schema without a migration, so an
-- instance migrated from this history never had it. Brings the history back
-- into agreement with prisma/schema.

-- CreateIndex
CREATE INDEX "File_checksum_idx" ON "File"("checksum");
