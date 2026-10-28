-- CreateTable
CREATE TABLE "DiscordLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discordUserId" TEXT NOT NULL,
    "discordName" TEXT NOT NULL,
    "userId" TEXT,
    "codeHash" TEXT,
    "codeExpiresAt" DATETIME,
    "linkedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscordLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscordLink_discordUserId_key" ON "DiscordLink"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordLink_codeHash_key" ON "DiscordLink"("codeHash");

-- CreateIndex
CREATE INDEX "DiscordLink_userId_idx" ON "DiscordLink"("userId");
