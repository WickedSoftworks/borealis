import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalPrisma = globalThis as unknown as {
  prisma: PrismaClient;
};

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const db =
  globalPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
    adapter,
  });

if (process.env.NODE_ENV !== "production") globalPrisma.prisma = db;
