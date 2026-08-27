# Database

The schema, the two-provider arrangement that keeps it portable, and the rules
you have to know before changing it. Companion to
[`architecture.md`](architecture.md), which covers how the code around it is
laid out.

Source of truth is `prisma/schema/` — this file explains it, it does not replace
it.

---

## One model set, two databases

Borealis runs on SQLite (default) or PostgreSQL. There is exactly one copy of
the models; what differs is a datasource block and a migration history.

Prisma will not take `datasource.provider` from an environment variable — it
must be a literal — so `bun run db:setup` does the substitution itself:

```
DATABASE_PROVIDER=sqlite            (or postgresql)
        │
        ├─ scripts/set-db-provider.mts
        │     copies prisma/providers/<provider>.prisma
        │       → prisma/schema/datasource.prisma
        │
        ├─ prisma.config.ts
        │     points migrations at prisma/migrations/<provider>/
        │
        └─ prisma generate → lib/generated/prisma/
```

Three files therefore agree with each other or nothing works:

| File | Reads `DATABASE_PROVIDER` to decide |
|---|---|
| `scripts/set-db-provider.mts` | which datasource template to copy |
| `prisma.config.ts` | which migration directory to use |
| `lib/db.ts` | which adapter to construct (`PrismaPg` vs `PrismaBetterSqlite3`) |
| `lib/auth.ts` | which provider to tell better-auth's Prisma adapter |
| `lib/search/index.ts` | `LIKE` (SQLite) or `tsquery` (Postgres) |

`prisma/schema/datasource.prisma` is **generated**. Edit the template in
`prisma/providers/`, never the generated file — `db:setup` overwrites it.

Because the client is generated for one provider, **changing provider is a
regenerate, and in Docker a rebuild.** The Dockerfile bakes it in with
`ARG DATABASE_PROVIDER`. A mismatch between the generated client and the
adapter surfaces immediately as a connection error rather than as quiet
misbehaviour, which is the intended failure mode.

---

## Conventions

- **Ids are `cuid()`** everywhere except `User`, `Session`, `Account`, and
  `Verification`, whose ids better-auth generates, and `AppSetting`, keyed by
  its own `key` string. The root account is the one hard-coded id: `"0"`.
- **No Prisma enums.** SQLite has none, and the schema must generate identically
  for both providers, so every enum-ish column is a `String`. The allowed values
  are listed in each model's doc comment. `prisma/schema/models.prisma:5` says
  they live in `lib/constants.ts`; that file does not exist yet, and the
  literals are currently scattered as bare strings across routes and the worker
  (roadmap item 5).
- **Byte counts are `BigInt`** — `File.size`, `Share.egressLimitBytes`,
  `Share.egressUsedBytes`, `Share.maxUploadBytes`, `ShareAccess.bytesServed`. A
  file host that overflows at 2 GB would be embarrassing.
- **Nullable means "unlimited" or "forever"**, consistently: `expiresAt`,
  `maxDownloads`, `egressLimitBytes`, `maxUploadFiles`, `maxUploadBytes`,
  `passwordHash`. There is no sentinel value for "no limit".
- **Revocation is soft, and so is deletion — for a while.** `revokedAt` keeps a
  share's audit trail readable after it stops working. `File.deletedAt` is a
  trash: the row and its bytes survive a retention window, then the `PURGE_FILE`
  job removes both together (see *Lifecycle*).
- **Timestamps are `@default(now())` / `@updatedAt`.** Nothing sets them by hand.

### `BigInt` at the JSON boundary

`JSON.stringify` throws on `BigInt`, so every route and page that returns byte
counts converts explicitly — `Number(file.size)` in `app/api/list/route.ts`,
`Number(share.egressUsedBytes)` in `app/api/shares/route.ts` and
`app/dashboard/page.tsx`. Anything new that returns one of the `BigInt` columns
must do the same, or the response 500s at serialisation time rather than at the
query.

---

## The shape

```mermaid
erDiagram
    User ||--o{ File : owns
    User ||--o{ Folder : owns
    User ||--o{ Share : owns
    User ||--o{ Session : has
    User ||--o{ Account : has
    User ||--o{ Invite : created
    User |o--o| Invite : redeemed

    Folder ||--o{ Folder : contains
    Folder ||--o{ File : contains

    Share ||--o{ ShareItem : bundles
    ShareItem }o--o| File : references
    ShareItem }o--o| Folder : references

    Share ||--o{ ShareAccess : records
    ShareAccess }o--o| File : "logged for"

    File ||--o| FileText : "indexed as"
```

`Job`, `AppSetting`, and `Verification` stand alone — no foreign keys in either
direction.

---

## Models

### `User`, `Session`, `Account`, `Verification`

better-auth's core tables plus the columns its `admin` plugin needs (`banned`,
`banReason`, `banExpires`, `Session.impersonatedBy`). **Field names are dictated
by better-auth and must not be renamed.**

`User.role` is a nullable string holding `"root" | "admin" | "user"`. Nullable
matters: `deletableFileWhere()` in `lib/permissions.ts` treats `null` as an
ordinary user, because pre-invite accounts may not have it set.

Exactly one root exists, `id "0"`, seeded by `bun run setup` with no `Account`
row at all — so there is no credential to sign in with until an operator runs
`root set-password`.

### `Invite`

One code, one account. `codeHash` is an unsalted SHA-256 of the plaintext, which
is shown once at creation and never stored.

| Column | Note |
|---|---|
| `codeHash` | `@unique` — the lookup index; the plaintext exists nowhere |
| `grantsRole` | `"user"` or `"admin"`. Only root may mint `"admin"` |
| `expiresAt` | null = never expires; default is 7 days |
| `revokedAt` | set while unused; a redeemed invite cannot be revoked |
| `redeemedAt` / `redeemedById` | set atomically when an account is created against it |

`redeemedById` is `@unique`, so an invite maps to at most one user and a user to
at most one invite. Both user relations are `onDelete: SetNull` — deleting a
user leaves the invitation history intact.

### `Folder`

A self-referencing tree (`parentId` → `FolderTree`) with an owner, a soft-delete
column, and a `ShareItem` relation for sharing a whole folder.

**Nothing creates one.** There is no folder API and no folder UI; the only
reference in the application is `lib/tus.ts:105`, which writes a client-supplied
`folderId` into a `File` row without checking ownership. See roadmap items 6 and
20 before building on this model.

### `File`

The central row. One per stored object.

| Column | Note |
|---|---|
| `storageKey` | `@unique`. Server-generated, never user input. The key a `StorageProvider` addresses, and also the tus upload id — so it must stay a single path segment |
| `originalName` | Attacker-controlled. Never interpolate it into a header without `contentDisposition()` (`lib/http.ts`) |
| `size` | `BigInt` |
| `checksum` | sha256 of the stored bytes, written by the `CHECKSUM` job after upload. Covers the ciphertext for an E2E file, never the plaintext. Null means "not yet computed" |
| `deletedAt` | Trash. Set by deleting your own file, cleared by restore, and read by the `PURGE_FILE` job once `TRASH_RETENTION_DAYS` have passed. Filtered by every list, search, and share query |
| `isEncrypted` | True when the bytes were encrypted in the browser. Suppresses text extraction |
| `encryptionMeta` | JSON `{ salt, iv, chunkSize, algorithm }`. Never key material |
| `folderId` | `onDelete: SetNull` — deleting a folder orphans its files rather than destroying them |

Indexed on `ownerId`, `folderId`, `deletedAt`, and `checksum` — the last one
non-unique, since identical bytes are legal today and it is groundwork for
dedupe.

### `Share`

One public token, one bundle, one set of limits. `type` is `"SEND"` (serves
files out) or `"REVERSE"` (collects files in); the reverse-only columns are
ignored for `SEND` and vice versa.

| Group | Columns | Enforced by |
|---|---|---|
| Identity | `token` (`@unique`; 16 random bytes as 22 base64url chars — 128 bits of entropy), `name`, `description` | — |
| Gate | `passwordHash` (scrypt, `scrypt$N$r$p$salt$hash`) | `guardShare()` step 7 |
| Clock | `expiresAt` (null = forever), `revokedAt` | `guardShare()` steps 2–3 |
| Caps | `maxDownloads` / `downloadCount`, `egressLimitBytes` / `egressUsedBytes` | `guardShare()` steps 5–6 |
| Mode | `viewOnly`, `isE2E` | `guardShare()` step 4; `isE2E` is presentational |
| Notify | `notifyOnDownload`, `notifyEmail` | enqueues a job nothing handles |
| Reverse | `maxUploadBytes`, `maxUploadFiles`, `requireUploader` | `openReverseShare()` in `lib/tus-reverse.ts` |

The counters are the accounting record: incremented in the `after()` block of
the share download route, inside one transaction with the `ShareAccess` write.

Indexed on `ownerId` and `expiresAt` — the latter for the hourly sweep.

Note that `passwordHash` must never leave the server. `GET /api/shares` strips
it and returns `hasPassword: boolean` instead.

### `ShareItem`

The join between a share and what it carries. Both `fileId` and `folderId` are
nullable, so a row points at one or the other; `folderId` is never set today.

`@@unique([shareId, fileId])` and `@@unique([shareId, folderId])` prevent
duplicates. Standard SQL null semantics apply: nulls do not collide in a unique
index, so those constraints do not restrict how many folder-less (or file-less)
rows a share may hold.

`fileId` is `onDelete: Cascade` — deleting a file removes it from every share
that carried it.

### `ShareAccess`

The audit trail, and the reason the product can claim containment.

`action` is `"VIEW" | "DOWNLOAD" | "UNLOCK_FAIL" | "UPLOAD"`. Rows carry
`ipAddress` (see `TRUST_PROXY`), `userAgent`, and `bytesServed`.

`fileId` is `onDelete: SetNull`, deliberately: the record of who fetched what
must outlive the file itself.

Indexed on `[shareId, createdAt]`, which serves both the per-share history and
the dashboard's reverse-chronological feed.

**Retention is 30 days**, hard-coded in `expireSweep()` (`lib/jobs.ts:70`), which
deletes older rows on its hourly pass. Not configurable, not surfaced in the UI,
and it silently truncates the audit trail. Know this before promising anyone a
longer history.

### `FileText`

Extracted document text, one row per file, primary-keyed by `fileId`.

`status` is `"PENDING" | "DONE" | "FAILED" | "SKIPPED"`, and `SKIPPED` carries a
human-readable `error` explaining why — `"end-to-end encrypted; the server
cannot read this file"`, `"no embedded text (likely a scan — OCR not enabled)"`,
`"no extractor for image/png"`. That string is the honest answer to "why can't I
find this file", so keep it useful.

Indexed on `status`. Content is capped at 400 000 characters, and files over
32 MB are not extracted at all (`lib/extract.ts`).

On Postgres the search query builds `to_tsvector` at query time; there is no
GIN index on it yet, so full-text search does a sequential scan. Adding one is a
raw-SQL migration Prisma will not generate for you.

### `Job`

The queue. `type`, a JSON `payload` string, `status`, `attempts`, `lastError`,
and `runAt`.

Indexed on `[status, runAt]` — exactly the shape of the worker's poll
(`status: "PENDING", runAt: { lte: now }`, ordered by `runAt`).

Deliberately not Redis or BullMQ: self-hosting must stay one container. The
consequences are documented in [`architecture.md`](architecture.md#background-work).
`EXTRACT_TEXT`, `CHECKSUM`, `EXPIRE_SWEEP`, and `PURGE_FILE` all have handlers;
`NOTIFY_DOWNLOAD` rows are still written and dropped.

### `AppSetting`

`key`/`value`/`updatedAt`, intended for runtime admin configuration (branding,
SMTP, S3, registration policy) editable without a restart. **Zero references in
the codebase** (roadmap item 17). Every setting today comes from `process.env`.

---

## Lifecycle: what happens when something is deleted

| Action | Effect |
|---|---|
| Delete **your own file** (`POST /api/file/[id]/delete`) | Every share carrying it is revoked, then `deletedAt` is set. The bytes stay for `TRASH_RETENTION_DAYS` (default 7) and the file is invisible to every list, search, and share |
| Delete **someone else's file** (same endpoint, needs admin or root) | Bytes and row go immediately, no trash. A moderation action its target could undo is not one |
| Restore (`POST /api/file/[id]/restore`) | `deletedAt` cleared, owner only. The revoked shares stay revoked — share it again |
| Empty the trash (`POST /api/trash/empty`) | Every trashed file of the caller's is purged inline, skipping the window |
| `TRASH_RETENTION_DAYS` after trashing | `expireSweep()` enqueues `PURGE_FILE`; the job removes bytes then row. `ShareItem` rows cascade away; `ShareAccess` rows survive with `fileId` nulled |
| Revoke a **share** (`DELETE /api/shares/[id]`) | `revokedAt` set. The row and its access log stay; the guard returns 404 from the next request |
| Expire a **share** | The guard refuses it immediately; the hourly sweep later sets `revokedAt` as housekeeping |
| Delete a **user** | `File`, `Folder`, `Share`, `Session`, `Account` cascade. `Invite.createdById` / `redeemedById` are nulled |
| Delete a **folder** | Child folders cascade; contained files survive with `folderId` nulled |
| 30 days after an access | The `ShareAccess` row is deleted by the sweep |

One gap follows from this table: abandoned tus uploads leave bytes on disk with
no `File` row and nothing that will ever remove them (roadmap item 18). The purge
job only knows about objects a `File` row points at, so it does not help there.

Note that trashed files still occupy disk and are not counted in the dashboard's
"Stored" figure, which sums live files only. The trash panel states its own
footprint separately, so the two numbers never silently disagree.

---

## Migrations

Two histories, one model set:

```
prisma/migrations/
  sqlite/       20260811162119_init, 20260811185733_invites
  postgresql/   20260811162807_init
```

They are separate because the generated SQL is dialect-specific — SQLite emits
`DATETIME` and inline `PRIMARY KEY`, Postgres emits `TIMESTAMP(3)` and separate
constraint declarations — so one history cannot serve both.

### Changing the schema

1. Edit `prisma/schema/models.prisma` (or `auth.prisma`).
2. For **each** provider: set `DATABASE_PROVIDER`, run `bun run db:setup`, then
   `bun run db:migrate:dev` against a database of that kind.
3. Commit both migration directories in the same change.

Step 2 is the one people skip, and skipping it is how the histories drift.

### The histories have already drifted

The `Invite` model exists only in the SQLite history. `prisma/migrations/postgresql/`
contains a single `init` migration, and it has no `Invite` table:

```
$ grep -rn 'Invite' prisma/migrations/postgresql/
$        # no output
```

A fresh Postgres instance therefore migrates cleanly and then fails at runtime
on anything touching invitations — which, since sign-up is closed and the gate
queries `Invite` on every account creation, is all account creation plus
`root invite` and the admin invitations panel.

The fix is to generate the missing migration against a real Postgres database
(`DATABASE_PROVIDER=postgresql bun run db:setup && bun run db:migrate:dev`) and
commit it. The roadmap's item 5 list and its P5 note describe this as a
folded-in migration; it is not folded in, it is absent. A CI job that migrates
both providers from empty would have caught it, and would catch the next one.

---

## Operating notes

- **SQLite** lives at `DATABASE_URL=file:./data/borealis.db` locally and
  `/app/data/borealis.db` in the container, on the `borealis-data` volume.
  Uploads are on `borealis-uploads`. Those two volumes are the backup surface —
  and there is no backup or restore command yet (roadmap item 19).
- **`prisma migrate deploy`** runs from `docker/entrypoint.sh` on every container
  start, before the server accepts a request.
- **`bun run db:studio`** opens Prisma Studio against the configured database.
- **Standalone scripts must run under Node, not Bun** — `better-sqlite3` does not
  work under the Bun runtime. `bun run root` is `tsx --env-file=.env`, and that
  is why.
- **Never point two providers at one directory.** `db:setup` rewrites
  `datasource.prisma` globally; running a Postgres-configured CLI against a
  SQLite-generated client fails at connect, which is the intended loud failure.
