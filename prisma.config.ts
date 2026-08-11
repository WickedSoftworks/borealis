import { defineConfig, env } from "prisma/config";

/*
  Load .env when it is available, but never require it.

  In a container the environment is supplied by the runtime and dotenv is not
  installed at all, so a hard `import "dotenv/config"` makes the Prisma CLI fail
  to load this file and migrations never run.
*/
try {
  require("dotenv/config");
} catch {
  // No dotenv — the environment is expected to be set already.
}

const provider =
  process.env.DATABASE_PROVIDER === "postgresql" ? "postgresql" : "sqlite";

export default defineConfig({
  // Must point at the DIRECTORY, not a single file. Pointing at one file makes
  // Prisma silently generate a client containing none of the other models.
  schema: "prisma/schema",

  // Migration SQL is dialect-specific (SQLite emits DATETIME and inline
  // PRIMARY KEY; Postgres emits TIMESTAMP(3) and separate constraints), so
  // each provider keeps its own history. `bun run db:setup` selects both the
  // datasource block and this path from DATABASE_PROVIDER.
  migrations: {
    path: `prisma/migrations/${provider}`,
  },

  datasource: {
    url: env("DATABASE_URL"),
  },
});
