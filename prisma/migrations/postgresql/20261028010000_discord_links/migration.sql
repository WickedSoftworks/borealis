-- CreateTable
CREATE TABLE "DiscordLink" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "discordName" TEXT NOT NULL,
    "userId" TEXT,
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscordLink_discordUserId_key" ON "DiscordLink"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordLink_codeHash_key" ON "DiscordLink"("codeHash");

-- CreateIndex
CREATE INDEX "DiscordLink_userId_idx" ON "DiscordLink"("userId");

-- AddForeignKey
ALTER TABLE "DiscordLink" ADD CONSTRAINT "DiscordLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
