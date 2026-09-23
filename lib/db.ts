import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

const connectionString: string = process.env.DATABASE_URL;

/**
 * The Prisma schema's provider is fixed at generate time by `bun run db:setup`
 * (Prisma has no dynamic provider), so the adapter here must match whatever
 * DATABASE_PROVIDER was set to then. A mismatch surfaces immediately as a
 * connection error rather than silently misbehaving.
 */
function createAdapter() {
  if (process.env.DATABASE_PROVIDER === "postgresql") {
    return new PrismaPg({ connectionString });
  }

  // better-sqlite3 wants a filesystem path, not a file: URL.
  return new PrismaBetterSqlite3({
    url: connectionString.replace(/^file:/, ""),
  });
}

const globalPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const db =
  globalPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
    adapter: createAdapter(),
  });

if (process.env.NODE_ENV !== "production") globalPrisma.prisma = db;
