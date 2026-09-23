# Borealis

Self-hosted file sharing with password-protected links, expiring shares, and
per-share transfer limits. Runs on SQLite and the local filesystem by default —
no external services required.

## Run it with Docker

One container, SQLite, local disk. Nothing else required.

```bash
cp .env.example .env
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env

docker compose up -d --build
docker compose exec borealis borealis-root invite --admin
```

That prints a single-use code. Open the URL, choose "Need an account?", and
redeem it.

The container refuses to start without `BETTER_AUTH_SECRET` — every session
cookie is signed with it, so a missing or rotating value means forgeable
sessions, and failing loudly beats failing quietly.

### Portainer

Paste `docker-compose.yml` into a stack and set these in the stack's
environment:

| Variable | |
|---|---|
| `BETTER_AUTH_SECRET` | **required** — `openssl rand -base64 32` |
| `BOREALIS_URL` | the public origin, e.g. `https://files.example.com` |
| `BOREALIS_PORT` | host port, default `3000` |

`BOREALIS_URL` must be what a browser actually types: OAuth callbacks and
emailed links are built from it. Everything else has a working default.

Two named volumes are created — `borealis-data` (the database) and
`borealis-uploads` (the files). Both appear in Portainer's volume list and are
what you back up. Deleting the stack does not delete them.

The image runs a healthcheck against `/api/health`, which touches the database,
so Portainer shows the container unhealthy if it is listening but cannot reach
its own storage.

### Postgres and S3

The Prisma client is generated at **build** time for one provider, so Postgres
means rebuilding:

```bash
DATABASE_PROVIDER=postgresql \
DATABASE_URL=postgresql://borealis:borealis@postgres:5432/borealis \
docker compose --profile postgres up -d --build
```

S3 needs no rebuild — set `STORAGE_DRIVER=s3` plus the `S3_*` variables.

## Quick start (without Docker)

```bash
bun install
cp .env.example .env

# Generate a real secret
openssl rand -base64 32   # paste into BETTER_AUTH_SECRET

bun run setup   # generate client, migrate, seed the root account
bun run dev
```

Sign-up is closed. To create the first real account:

```bash
bun run root invite --admin   # prints a single-use code, once
```

Open http://localhost:3000, choose "Need an account?", and redeem it.

## Accounts

Three roles, in a deliberate hierarchy.

**root** (`id 0`) is seeded by `bun run setup` with no credential at all — it
cannot be signed into from the web until someone with shell access sets a
password. Control of the instance follows control of the server, not knowledge
of a URL.

```bash
bun run root set-password    # opens web sign-in for root
bun run root disable-login   # closes it again
bun run root invite --admin  # mint an admin invitation
bun run root status          # accounts and outstanding invitations
```

**admin** can invite ordinary users and manage the instance, but *cannot* mint
another admin and cannot revoke another admin's invitations. Admins do not have
authority over each other by design — widening that circle is root's decision
alone.

**user** is an ordinary account.

## Email and password reset

Set `SMTP_HOST` and `SMTP_FROM` to enable delivery. Everything else about mail
is optional; the product works without it, since invitation codes are handed
over out-of-band anyway.

**Without SMTP configured, mail is written to the server log rather than
dropped.** An operator debugging "the reset link never arrived" should find the
link, and the reason, in their own logs.

### Reset requires a verified address

Password reset only works for an account whose email has been confirmed. An
unverified address is not evidence of anything — anyone can type someone else's
email at sign-up, and letting that address receive a reset link would turn
account creation into account takeover.

A verification email goes out at sign-up. Until it is confirmed, requesting a
reset returns the same "if that address belongs to a confirmed account…"
response as an unknown address, because saying otherwise would confirm which
accounts exist.

Accounts that can't be reset by email are reset from the console:

```bash
bun run root passwd someone@example.com
```

That is the only recovery path on an instance with no SMTP, and it deliberately
requires shell access to the machine.

## Invitations

Every account must be created against a single-use invitation code. The check
lives in better-auth's `user.create.before` hook, so it covers email sign-up,
every social provider, and OIDC through one gate — there is no provider that
routes around it.

Codes are stored as SHA-256 hashes and the plaintext is shown exactly once at
creation. There is no "show it again"; mint a new one instead. Codes expire
(7 days by default), can be revoked while unused, and burn the moment an
account is created against them.

## Configuration

All configuration is environment-based — see `.env.example` for the full list.

### Database

`DATABASE_PROVIDER` selects `sqlite` (default) or `postgresql`.

Prisma cannot take its provider from an environment variable, so `bun run
db:setup` copies the matching template from `prisma/providers/` into
`prisma/schema/datasource.prisma`. Migrations are also dialect-specific and live
in `prisma/migrations/<provider>/`. **Re-run `bun run db:setup` after changing
the provider**, and regenerate both migration histories whenever the models
change.

```bash
DATABASE_PROVIDER=postgresql
DATABASE_URL="postgresql://user:pass@localhost:5432/borealis"
```

### Storage

`STORAGE_DRIVER` selects `local` (default) or `s3`. Any S3-compatible service
works, including MinIO:

```bash
STORAGE_DRIVER=s3
S3_BUCKET=borealis
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
```

### Authentication

Email/password is always on. OAuth providers register only when **both** halves
of their credential pair are set, so you can configure just the ones you use.
Supported: Discord, GitHub, Google, Microsoft, plus any OpenID Connect provider
via `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`.

Set `TRUST_PROXY=true` only when running behind a reverse proxy you control —
it makes the audit log trust `X-Forwarded-For`.

## Sharing

Shares are created via `POST /api/shares` and served at `/s/<token>`.

**Expiry** — presets (24 hours, 1 week, 1 month, 1 year, 5 years, forever), a
custom duration, or an explicit "until" date. All resolve server-side to a single
nullable timestamp where null means forever.

**Password** — hashed with scrypt. Clearing the gate sets a signed, HTTP-only
cookie scoped to that one share and bound to the current password hash, so
changing the password revokes every outstanding unlock.

**Limits** — `maxDownloads` and `egressLimitBytes` cap downloads and total bytes
served, protecting a self-hosted box if a link leaks.

Every access is recorded in `ShareAccess`, including failed password attempts.

**End-to-end encryption** — tick "Encrypt in this browser" before uploading and
the file is AES-GCM encrypted client-side, in 4 MB chunks with a per-chunk IV,
before any byte is sent. The server stores ciphertext and cannot read it at any
privilege level, root included. The key is generated in the browser, kept in
that browser's `localStorage`, and travels to recipients in the URL fragment
(`/s/<token>#k=<fileId>.<key>`), which browsers never transmit.

Two consequences, both surfaced in the interface: the filename, size, and
content type are still visible to the server, and the key has exactly one copy —
clear the browser's site data and the file is unrecoverable for everyone. A link
that gets truncated past the `#` cannot be repaired server-side.

Decryption happens in memory, so encrypted files are bounded by the recipient's
RAM in a way ordinary streamed downloads are not.

**Reverse shares** — a link that collects instead of serves, created from the
dashboard's "Collect files" and served at `/r/<token>`. Anyone holding it can
upload into the owner's vault without an account, bounded by a file count, a
per-file size cap, and the usual expiry. They never see anything already stored.

## Search

`GET /api/search?q=` searches filenames and extracted document text, scoped to
the caller's own files — admins can delete other people's files but cannot read
them. Text is pulled from plain text, PDF, and DOCX by a background worker;
scanned images are stored but not indexed, and end-to-end encrypted files are
skipped because the server has nothing readable to index.

SQLite uses `LIKE`; PostgreSQL uses `websearch_to_tsquery` with `ts_headline`
snippets.

## Development

```bash
bun run typecheck
bun run lint
bun run build
```

### Runtime notes

- `better-sqlite3` does not work under the Bun runtime
  ([oven-sh/bun#4290](https://github.com/oven-sh/bun/issues/4290)). This does not
  affect the app — `next dev`/`next build` run on Node — but standalone scripts
  that touch the database must run under Node, not `bun run`.
- This is Next.js 16: `middleware.ts` is now `proxy.ts`, and dynamic route
  `params` is a Promise. Check `node_modules/next/dist/docs/` before writing
  Next-specific code.
