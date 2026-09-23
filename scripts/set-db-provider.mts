/**
 * Prisma's `datasource.provider` must be a literal string — env() and array
 * providers are not supported. To support both SQLite (default) and Postgres
 * from one model set, we copy the matching template from prisma/providers/
 * into prisma/schema/datasource.prisma. The models themselves are never
 * duplicated.
 *
 * Run via `bun run db:setup`.
 */
import fs from "node:fs";
import path from "node:path";

const PROVIDERS = ["sqlite", "postgresql"] as const;
type Provider = (typeof PROVIDERS)[number];

const provider = (process.env.DATABASE_PROVIDER ?? "sqlite") as Provider;

if (!PROVIDERS.includes(provider)) {
  console.error(
    `DATABASE_PROVIDER must be one of: ${PROVIDERS.join(", ")} (got "${provider}")`,
  );
  process.exit(1);
}

const root = path.join(import.meta.dirname, "..");
const source = path.join(root, "prisma", "providers", `${provider}.prisma`);
const target = path.join(root, "prisma", "schema", "datasource.prisma");

fs.copyFileSync(source, target);

console.log(`Prisma datasource set to "${provider}".`);
