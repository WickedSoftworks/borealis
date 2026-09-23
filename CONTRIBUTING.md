# Contributing to Borealis

Read [`PRODUCT.md`](PRODUCT.md) first — it is the authority on what the product
is for and what the interface may and may not claim. Then
[`docs/architecture.md`](docs/architecture.md) for how the code is laid out and
[`docs/database.md`](docs/database.md) before touching the schema.

## Setting up

```bash
bun install
cp .env.example .env        # then set BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL
bun run setup               # generate the client, migrate, seed root
bun run root invite --admin # a code for your first account
bun run dev
```

This is Next.js 16. APIs and conventions differ from older versions —
`middleware.ts` is `proxy.ts`, `params` and `searchParams` are Promises — and
the bundled docs in `node_modules/next/dist/docs/` are the reference, not
memory.

## Before you open a pull request

```bash
bun run typecheck
bun run lint              # Biome; `bun run format` fixes formatting
bun test                  # unit tests, a second or two
bun run build
bun run test:integration  # against that build, about half a minute
```

CI runs all five, migrates both database providers from empty and checks the
result against the schema, and builds the container image.

`test/integration/` copies `.next/standalone` to a temp directory — outside
the project, so a file the build's trace missed fails here instead of being
quietly loaded from your `node_modules` — and starts it on a fresh temp
database and upload directory per file, seeds fixtures with `bun:sqlite`, and
speaks HTTP to it. The standalone build copies your `.env` next to the server;
the harness leaves it out of the copy and overrides every key in it, so the
suite never sees your database, storage, or mail settings. Files there are
named `*.integration.ts` so that plain `bun test` leaves them alone — add new
ones to the `test:integration` script.

## House rules

**Policy lives in `lib/`, and is pure where it can be.** Route handlers parse,
authorise, and respond. Anything that could be wrong — a limit, a rule, an
order of checks — goes in a module with no database or clock of its own, with
a `*.test.ts` beside it. The share guard, the lockout schedule, the quota
arithmetic, range parsing, and the ZIP writer are all written this way.

**Comments say why.** The codebase explains its decisions where they are made,
including the ones that look odd. Keep doing that; a clever line with no
reason given is a line the next person will "fix".

**The interface never claims more than is true** (PRODUCT.md, principle 4). If
a feature has an edge — a limit that only works behind a trusted proxy, an
email that is logged instead of sent — the control says so.

**Enum-ish columns are strings.** SQLite has no enums. Allowed values live in
`lib/constants.ts`; add new ones there first.

**Byte counts are `BigInt`.** Convert with `Number()` at the JSON boundary, or
the response 500s at serialisation.

## Changing the schema

Two migration histories, one model set:

1. Edit `prisma/schema/models.prisma` or `auth.prisma`.
2. For each provider, generate a migration. SQLite: `bun run db:migrate:dev`.
   Postgres: `DATABASE_PROVIDER=postgresql bun run db:setup` against a real
   Postgres (`docker compose --profile postgres up -d postgres` works), then
   `bun run db:migrate:dev`. `prisma migrate diff --from-schema … --to-schema …
   --script` produces the SQL without a database when you only need the diff.
3. Commit both directories in the same change, and run `bun run db:setup`
   again to put the generated client back on SQLite.

CI fails if either history does not reproduce the schema exactly.

## Browser checks

`puppeteer-core` is a dev dependency for driving a real browser against a dev
server — for checking a flow end to end, or taking screenshots of both themes
for a design review. It uses whatever Chromium-family browser is installed
(`executablePath`), so nothing is downloaded. Point such scripts at a scratch
database and upload directory (`DATABASE_URL=file:/tmp/borealis-test.db
STORAGE_PATH=/tmp/borealis-uploads`), never at data you care about: the
background worker runs in the dev server too, and it will purge trash and
sweep uploads on its first pass.

## Security

Report vulnerabilities privately to the maintainer rather than in a public
issue. Anything touching `lib/shares/guard.ts`, the two tus mounts, the byte
routes, or `lib/request.ts` deserves a second reviewer.
