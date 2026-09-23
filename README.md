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

### Virus scanning

Optional. Run the bundled ClamAV service and point Borealis at it:

```bash
CLAMAV_HOST=clamav docker compose --profile clamav up -d
```

Every upload the server can read is streamed to clamd, and a file it
recognises is withheld from every share and collection link. clamd takes a
few minutes and about 1.5 GB of memory to load its signatures on first start.
Signature scanning catches known malware; the interface says "no known
threats", never "safe", and end-to-end encrypted files cannot be scanned.

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

### Your account

`/dashboard/account` is where anyone changes their name, email, and password,
sees every browser they are signed in on and signs any of them out, and
deletes their account and everything in it.

**Two-step sign-in** — an authenticator app (TOTP), with single-use backup
codes shown once at enrolment. Replayed codes are refused.

**Passkeys** — sign in with a fingerprint, face, or device PIN instead of a
password, from the sign-in page's button or the browser's own autofill. A
passkey skips the authenticator-app step, so Borealis only accepts passkeys
that verify the person (a PIN or biometric, not merely a key being present).
Passkeys are bound to the host in `BETTER_AUTH_URL`: **moving the instance to
a new domain orphans every registered passkey**, and people sign in with
their password again and re-add them.

Sign-in, sign-up, two-step codes, password reset, and passkey sign-in are
rate-limited per address, stored in the database so a restart does not reset
anyone's window. `RATE_LIMIT=off` disables that.

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

Configuration is environment-based — see `.env.example` for the full list,
with defaults. The instance name, storage limits, audit retention, denied
addresses, and SMTP can also be changed at runtime in **Admin → Settings**,
without a restart; a value saved there wins over the environment, and the
panel shows which one is in effect. The SMTP password is encrypted at rest.

### Storage limits

Three ceilings, all optional and off by default:

| Variable | Limits |
|---|---|
| `MAX_UPLOAD_SIZE` | one upload |
| `DEFAULT_QUOTA` | each account (override per user in Admin → Users) |
| `STORAGE_CEILING` | the whole instance |

Sizes take `50GB`, `512 MB`, or a byte count. They are checked when an upload
starts, before any bytes arrive, and trash counts until it is purged. Uploads
through a collection link count against the link owner's quota.

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

### Behind a reverse proxy

`TRUST_PROXY` decides which `X-Forwarded-For` entries to believe, and so the
address recorded in the access log and used by rate limits, lockouts, and IP
allow lists:

| Value | Meaning |
|---|---|
| `false` (default) | trust nothing; no client address is recorded |
| `1` | one proxy in front (Caddy, nginx, Traefik) — the usual setup |
| `2`, `3`, … | that many proxies in a chain |
| `10.0.0.0/8, 172.16.0.0/12` | exactly these proxy addresses |
| `true` | the whole header — forgeable unless your proxy overwrites it |

`DENIED_IPS` refuses addresses or ranges everywhere — sign-in, shares, and
uploads. Both need a correct `TRUST_PROXY` to see real addresses.

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

**Lockout** — after five wrong passwords a link locks, for a minute and then
doubling up to fifteen, and refuses even the right password until then. The
lock belongs to the link, not the caller's address, so it holds against
someone rotating addresses.

**Allowed networks** — a share can be limited to addresses or CIDR ranges.
Anything else gets a "not from here" page, and the attempt is recorded.

**Preview and "get all"** — images, PDFs, and text files open in the page
without a download, under a sandboxing content security policy. A share of
several files offers one ZIP of all of them, streamed with an exact size,
which counts as one download.

**Download notification** — with "Email me on download" the owner gets a
message per download (at most ten an hour per link), naming the file and the
address it was fetched from.

Every access is recorded in `ShareAccess`, including failed password attempts
and refused addresses, kept for `AUDIT_RETENTION_DAYS` (30 by default). The
dashboard's **Activity** page filters it and exports CSV.

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
them. Results are paged with a total count, and filter by type, size, date, and
folder.

A background worker pulls text from plain text and markup, PDF, DOCX, XLSX,
PPTX, OpenDocument, EPUB, RTF, and email (`.eml`). Images and scanned PDFs are
read by **OCR** — Tesseract compiled to WebAssembly, running in-process with
the English model bundled, so nothing is fetched from the network. OCR is the
slowest job the worker runs; `OCR=off` turns it off, and those files are then
stored and served but not indexed. OCR reads what it can: a sharp scan indexes
well, a blurry photo yields little. Other languages need their model in
`OCR_LANG_PATH` and `OCR_LANGUAGES=eng+deu`.

End-to-end encrypted files are skipped because the server has nothing
readable to index.

SQLite uses `LIKE`; PostgreSQL uses `websearch_to_tsquery` with `ts_headline`
snippets.

## Operating it

**Backups** — the console snapshots the SQLite database (consistently, with
`VACUUM INTO`) and every stored file into a plain directory with a manifest:

```bash
bun run root backup              # into $BACKUP_DIR, default ./backups
bun run root restore <dir> --yes # with the server stopped

# In Docker: backups land in the data volume (/app/data/backups);
# copy them off the box too.
docker compose exec borealis borealis-root backup
docker compose cp borealis:/app/data/backups ./backups
```

A restore keeps the database it replaces beside it as
`<name>.before-restore-<time>`, and never overwrites a stored file that is
already present. Postgres and S3 are not copied — `pg_dump` and bucket
versioning do that job better, and the manifest says they were skipped.

**Admin panel** — besides users, invitations, and files: **Settings** (above),
**Jobs** (queue depth, failures with their error, retry or discard),
**Storage** (a daily check for objects no file points at, with a report and a
delete button; `RECONCILE_DELETE=true` deletes automatically), and an **audit
log** of what admins did — bans, role changes, quota changes, deletions,
settings changes.

**Background work** — one process at a time runs the hourly sweep and the
daily storage check, coordinated through the database, so several replicas
can share one database. A job stuck mid-run for 30 minutes is recovered, and
unfinished uploads are removed after `UPLOAD_EXPIRY_HOURS` (24).

**Observability** — `LOG_FORMAT=json` for a log shipper; Prometheus metrics at
`/api/metrics` behind `METRICS_TOKEN`; every server error POSTed to
`ERROR_WEBHOOK_URL` when set. `/api/health` stays the unauthenticated probe.

**Security headers** — every page gets a per-request content security policy,
and HSTS when `BETTER_AUTH_URL` is https. Downloads are always attachments;
only an allowlist of types is ever served inline, for preview. Every served
file carries `nosniff` and a no-script content security policy, sandboxed for
everything but PDF — Chrome's viewer refuses to render in a sandbox.

## Development

```bash
bun run typecheck
bun run lint
bun test                  # unit tests
bun run build
bun run test:integration  # against the build: share routes, worker, OCR
```

Integration tests run a copy of the production build (`.next/standalone`) from
a temp directory, on a throwaway database and upload directory, and never see
your `.env`.

### Runtime notes

- `better-sqlite3` does not work under the Bun runtime
  ([oven-sh/bun#4290](https://github.com/oven-sh/bun/issues/4290)). This does not
  affect the app — `next dev`/`next build` run on Node — but standalone scripts
  that touch the database must run under Node, not `bun run`.
- This is Next.js 16: `middleware.ts` is now `proxy.ts`, and dynamic route
  `params` is a Promise. Check `node_modules/next/dist/docs/` before writing
  Next-specific code.
