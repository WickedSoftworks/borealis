# What to add to Borealis

An audit of the codebase as of `feat/file-host` @ `1ccbf2a`, listing what is
missing, what is half-built, and what is claimed but not implemented.

Every item cites the file that proves it. Items are grouped by kind and ordered
within each group by how much they hurt.

**Tier key**

- **P0** — something is broken, or the product claims a capability it does not have.
- **P1** — core product gaps a user will hit in normal use.
- **P2** — self-hosting and operations.
- **P3** — security hardening.
- **P4** — interface and recipient experience.
- **P5** — codebase, tests, docs, contributor experience.

---

## P1 — Core product gaps

### 7. Shares cannot be edited after creation — **done**

`PATCH /api/shares/[id]` and an edit dialog, reachable from every live send
link on the dashboard.

- **Absent means "leave it", null means "clear it".** The distinction the
  folders route already draws, so an untouched field can never overwrite itself
  with a stale value. Name, description, password, expiry, download cap, egress
  cap, `viewOnly`, and the notify fields are all editable, as is the file and
  folder set.
- **Password rotation, finally reachable.** `signUnlockToken` HMACs over the
  current hash, so writing a new one invalidates every outstanding unlock with
  no cookie-clearing code — the README has claimed this since it was written and
  nothing could trigger it. Verified end to end: a cookie that downloads before
  the rotation is refused after it. Setting the password to null drops the gate.
- **Expiry is lossy, so the field grew a "Keep current" chip.** Only the
  resolved `expiresAt` is stored, never the preset behind it, so a dialog
  defaulting to "1 week" would silently extend every link opened for an
  unrelated reason. Keeping it omits `expiry` from the request entirely, which
  also lets an expired link be edited and then revived by picking a new preset.
- **A cap below current usage closes the link on save.** Legitimate — it is how
  you stop a link you have had second thoughts about — so `capWarnings` in
  `lib/shares/edit.ts` says so first, using the rule `guardShare` enforces
  rather than a second copy of it. `downloadCount` and `egressUsedBytes` are
  not resettable; they are the accounting.
- **Membership is a full picker.** `components/share-item-picker.tsx` takes the
  whole tree at once, since `VaultBrowser` is fed one folder at a time by the
  server and navigates by pushing `?folder=`. Files inside a selected folder
  show as carried-but-not-tickable, because a folder share resolves live.
- **Adding an encrypted file warns, then hands back a rebuilt link.** The key
  rides in the fragment, so copies already sent have none for the new file.

`lib/shares/edit.ts` is the pure seam — `diffShareItems`, `capWarnings` — with
no database, clock, or crypto, so both are unit tested and the dialog imports
the second one directly.

Revoking stays a one-way door: `PATCH` scopes to `revokedAt: null` like
`DELETE`, and refuses a `REVERSE` share, whose upload settings want their own
route.

### 9. Downloads buffer the whole file into memory — **done**

Both routes now stream, and negotiate `Range`:

- **One seam.** `serveFile()` in `lib/download.ts` frames every body, so the
  owner route and the guarded share route cannot drift on headers, status, or
  counting. Neither calls `storage.download()` any more.
- **The arithmetic is pure.** `lib/range.ts` resolves a `Range` header against
  an object size and answers `full`, `partial`, or `unsatisfiable` — no
  request, no storage, no clock — so it is exhaustively unit tested in
  `lib/range.test.ts`. A range spanning the whole object resolves to `full`,
  which is what stops `bytes=0-` being treated as a seek.
- **The slice is pushed down.** `StorageProvider.stream(key, range?)` takes an
  inclusive range: `createReadStream({ start, end })` locally, `Range` on the
  `GetObjectCommand` for S3. The bytes never leave the disk or the bucket.
- **Failures happen before the first byte.** A status line cannot be taken back
  once it has gone out, so `stream()` now opens eagerly and rejects on a missing
  object rather than surfacing an error mid-stream. A row whose object is gone
  is a clean 404, not a truncated 200.
- **Egress is counted from the stream.** `lib/metering.ts` reports what actually
  went out, which is the point the old `buffer.byteLength` got wrong: a
  recipient who takes 20 MB of a 1 GB file and hangs up is charged 20 MB.
  `downloadCount` increments only for a whole-file request, so a media scrub
  cannot exhaust a three-download cap. `NOTIFY_DOWNLOAD` is enqueued on the same
  rule — one per download, not one per seek.
- **`Cache-Control: private, no-transform`.** Not hygiene: Next compresses route
  handler responses by default, and a gzipped body loses its `Content-Length`
  and stops agreeing with the offsets in `Content-Range`.

Still open: `HEAD` is not implemented — media players that probe with one fall
back to `Range: bytes=0-0`, which is answered correctly. Multi-range requests
are answered whole rather than with a `multipart/byteranges` body. And the
egress cap can still be overshot by concurrent downloads, because the guard's
pre-check reads a counter that is only incremented once the body has finished;
closing that needs a conditional atomic update, not a change here.

### 10. No "download all" for a multi-file share

A share bundles many files (`ShareItem` is a list, the dialog builds from a
multi-select), but the recipient gets one button per row. A ten-file share is
ten clicks.

**Add:** a streaming ZIP of the whole share. Skip E2E files or decrypt them
client-side; a server-side ZIP of ciphertext would be useless.

### 11. No account settings

There is no account page. A `grep` for `changePassword`, `updateUser`, and
`deleteUser` across `app/`, `components/`, and `lib/` returns nothing but a
`signOut` in `components/vault-header.tsx:57`.

A signed-in user cannot change their password (the only route is the
forgot-password email flow, which per the README requires a verified address and
otherwise requires shell access to the box), change or re-verify their email,
set a display name, see or revoke their active sessions, or delete their account.

**Add:** `/dashboard/account` covering all of the above. Session listing and
revocation matters most on an instance shared with people you half-trust.

### 12. Search is capped at 25 results with no pagination

`app/api/search/route.ts:35` and both providers in `lib/search/index.ts`
hard-code `take: 25` / `LIMIT 25`. There is no offset, no cursor, no total count,
and the UI has no "more".

**Add:** cursor pagination and a result count. Also worth adding: filters
(type, size, date, folder) and sort, since the query is already provider-split.

### 13. The dashboard loads every file on every render

`app/dashboard/page.tsx:23` does `db.file.findMany({ where: { ownerId } })` with
no `take`, then `components/file-table.tsx` renders all of them. At a thousand
files the page payload and the DOM both become the bottleneck. Shares
(`:31`) are unbounded too.

**Add:** server-side pagination or virtualisation, and column sorting while
you're in there.

### 14. Text extraction covers three formats

`lib/extract.ts` handles plain text (plus JSON/XML/YAML/TOML), PDF via `unpdf`,
and DOCX via `mammoth`. Everything else returns `no extractor for …`.
`PRODUCT.md` is explicit that the interface must not claim OCR.

**Add, in rough order of value:** OCR for scanned images and image-only PDFs
(tesseract.js keeps it in-container), then XLSX/CSV, PPTX, ODT/ODS, EPUB,
RTF, and email formats.

### 15. No thumbnails

`sharp` appears in `package.json`'s `ignoreScripts` and `trustedDependencies`
but is not a dependency and is imported nowhere. The file table shows a generic
`IconFile` for everything.

**Add:** thumbnail generation as a job type, stored beside the original, shown
in the file table and on the share page. Skip E2E files — the server cannot read
them, and saying so in the UI is better than a blank square.

---

## P2 — Operations and self-hosting

### 16. No storage quotas

Nothing limits how much any user stores. On a multi-account instance one user
can fill the disk. `Share.egressLimitBytes` caps a *link*; nothing caps an
*account*, and nothing caps the instance.

**Add:** a per-user quota with a sensible default, an instance-wide ceiling,
quota display in the dashboard, and a refusal at the tus `onUploadCreate` gate
rather than after the bytes have landed.

### 17. `AppSetting` is entirely unimplemented

The model exists and its doc comment describes exactly what it is for: "runtime
admin configuration (branding, SMTP, S3, registration policy), editable from the
admin panel without a restart". Zero references in the codebase — every setting
is read from `process.env` at boot, so any change needs a container restart, and
on Postgres a change of provider needs a rebuild.

**Add:** a settings service reading `AppSetting` with env fallback, and an admin
settings panel. Instance name and branding are the easy first cut; SMTP with a
"send test email" button is the one operators will actually thank you for.

### 18. Abandoned tus uploads are never cleaned up

`lib/tus.ts` and `lib/tus-reverse.ts` configure no `expiration`, and no job
sweeps the store. A recipient who starts a 2 GB upload through a reverse share
and closes the tab leaves 2 GB on disk with no database row and nothing that
will ever remove it.

**Add:** tus expiration plus a sweep job; extend `expireSweep()` in
`lib/jobs.ts:63` to reconcile orphaned objects against `File` rows.

### 19. Operational blind spots

Several smaller gaps that all bite the same unattended-for-months operator that
`PRODUCT.md` principle 5 promises to serve:

- **No backup or restore path.** The README names the two volumes but gives no
  procedure, and there is no export. A `borealis backup` / `restore` in
  `scripts/root.mts` would fit the existing console-tool pattern.
- **No metrics.** `/api/health` returns `{status:"ok"}` and nothing else. No
  disk usage, no job queue depth, no failed-job count. A `FAILED` job is visible
  only in stdout.
- **Failed jobs are invisible and unretryable.** After `MAX_ATTEMPTS` (3) a job
  sits at `FAILED` forever with no admin surface and no manual retry.
- **The worker is single-process and unlocked.** `runOne()` claims with a
  scoped `updateMany` — correct — but `instrumentation.ts` starts a worker in
  every process, so horizontal scaling means N workers polling one table and N
  `EXPIRE_SWEEP` enqueues per hour.
- **Audit retention is hard-coded.** `expireSweep()` deletes `ShareAccess` rows
  older than 30 days (`lib/jobs.ts:65`). Not configurable, not documented in the
  README, and it silently destroys the audit trail the product sells.
- **No structured logging.** `console.log`/`console.warn` throughout. No request
  ids, no levels, nothing a log aggregator can parse.

---

## P3 — Security hardening

### 20. `folderId` is taken from upload metadata and never validated

`lib/tus.ts:105` writes `folderId: metaString(upload.metadata, "folderId")`
straight into the `File` row. The value comes from client-supplied tus metadata.
`Folder` has an `ownerId`, and it is not checked.

Today this is inert — nothing creates folders, so there are no ids to guess. The
moment item 6 ships it becomes a live IDOR: a user can file uploads into another
user's folder. Fix it now, while it costs one query.

### 21. No rate limiting anywhere

`grep -rni "ratelimit|rate-limit|throttle"` across `app/`, `components/`, and
`lib/` returns nothing. Unprotected:

- **Share password unlock** (`app/api/s/[token]/unlock/route.ts`). The endpoint
  is careful — uniform denials, `UNLOCK_FAIL` logged with IP — but an attacker
  can try passwords as fast as scrypt will run. `UNLOCK_FAIL` rows are recorded
  and never *acted on*.
- **Login and password reset**, which better-auth can rate-limit but this config
  does not.
- **Invite redemption**, letting codes be brute-forced.
- **Uploads and downloads**, so one client can saturate the box.

**Add:** rate limiting at the guard and auth layers, plus progressive lockout on
a share after N `UNLOCK_FAIL` rows — the data is already being collected.

### 22. Smaller security items

- **No 2FA.** better-auth ships a `twoFactor` plugin; `lib/auth.ts` registers
  only `admin` and `genericOAuth`. Also no passkeys.
- **No CSP or security headers.** `next.config.ts` sets no `headers()`. No CSP,
  `X-Frame-Options`, `X-Content-Type-Options`, or `Referrer-Policy` — worth
  having on a page that serves attacker-supplied files.
- **Downloads are served from the app origin.** A stored HTML or SVG file with
  `Content-Type: text/html` executes on the same origin as the session cookie.
  `contentDisposition()` sets `attachment`, which mitigates it today, but item 3
  (inline preview) removes that mitigation. Serve user content from a separate
  origin, or force a neutral content type for anything not on an allowlist.
- **No virus scanning.** A reverse share accepts files from anyone with a link.
  ClamAV as an optional job type would fit the existing worker.
- **No admin audit log.** `ShareAccess` records what recipients did; nothing
  records that an admin banned a user, changed a role, or deleted someone's
  file. `app/api/admin/users/[id]/route.ts` performs all three silently.
- **No IP allow/deny list** per share or instance-wide.
- **`TRUST_PROXY` is all-or-nothing.** No trusted-proxy CIDR list, so a
  misconfiguration makes every audit-log IP forgeable.

---

## P4 — Interface and recipient experience

- **No file preview anywhere** — see item 3. It affects owners too: you cannot
  check what a file is without downloading it.
- **No rename.** `File.originalName` is fixed at upload.
- **No bulk actions beyond share.** `components/file-table.tsx` has a working
  multi-select, but the only thing bound to it is the share dialog. No bulk
  delete, no bulk download, no bulk move.
- **No drag-and-drop upload,** no folder upload, no paste-to-upload.
- **No QR code** for a share link. Links get sent to phones; this is cheap.
- **Share description is collected and barely used.** It is in the schema and
  the dialog (`components/share-dialog.tsx:216`) — check it is actually rendered
  to the recipient with the same care the rest of the share page shows.
- **No dark/light toggle.** `PRODUCT.md` makes both themes binding; confirm
  there is a user-facing control and not just a media query.
- **No i18n.** Every string is hard-coded English. Recipients are strangers on
  the internet, which is the strongest case for translation any part of this
  product has.
- **No empty-state guidance** for a brand-new account with no files.
- **No upload progress detail** — per-file speed, ETA, and a resume affordance
  after a dropped connection, which tus already supports underneath.
- **Access log is truncated to 12 rows** (`app/dashboard/page.tsx:47`) with no
  full view, no filter, and no export. The audit trail is a headline feature and
  this is the only window onto it.

---

## P5 — Codebase and contributor experience

- **No CI.** No `.github/` at all. `typecheck`, `lint`, `build`, and `test` are
  all in `package.json` and nothing runs them.
- **Four test files, all unit.** `lib/crypto/{e2e,fragment,keyring}.test.ts` and
  `lib/permissions.test.ts`. Nothing tests the share guard — the single most
  security-critical function in the app — nor expiry resolution, nor any API
  route, nor the job worker. Integration tests against the routes would catch
  every P0 in this document.
- **No Dependabot or vulnerability scanning.**
- **No error tracking.** No Sentry or equivalent; a 500 in a recipient's browser
  leaves no trace an operator will ever see.
- **`puppeteer-core` is a dev dependency for `.impeccable/` screenshot scripts.**
  Fine, but undocumented — a contributor cannot tell what `shots2.mjs` is for.
- **Two migration histories to keep in sync by hand, and they have already
  drifted.** `prisma/migrations/sqlite` has two migrations,
  `prisma/migrations/postgresql` has one — and the `Invite` table is **not**
  folded into the Postgres `init`, it is absent from that history entirely
  (`grep -rn Invite prisma/migrations/postgresql/` returns nothing). A fresh
  Postgres instance migrates cleanly and then fails on every account creation,
  `root invite`, and the admin invitations panel, because the sign-up gate
  queries a table that was never created. Generate the missing migration against
  a real Postgres database and commit it. A CI job that migrates both providers
  from empty would have caught this, and would catch the next one.
- **No CONTRIBUTING.md, no LICENSE, no CHANGELOG.**

---

## Quick reference: schema fields with no implementation

| Field / model | Status |
|---|---|
| `Folder` (whole model) | No API, no UI. One unvalidated write in `lib/tus.ts:105`. |
| `ShareItem.folderId` | Never set — folders cannot be shared. |
| `File.checksum` | Never computed. Always null. |
| `File.deletedAt` | Implemented — trash, with a purge job behind it. |
| `Share.notifyOnDownload` / `notifyEmail` | Job enqueued, worker has no handler. |
| `Share.viewOnly` | Enforced by the guard; no viewer exists to make it useful. |
| `AppSetting` (whole model) | Zero references. |
| `Job` type `NOTIFY_DOWNLOAD` | Enqueued, unhandled, silently marked `DONE`. |
| `Job` type `PURGE_FILE` | Implemented — enqueued by the sweep, handled by the worker. |
| `lib/constants.ts` | Referenced by `models.prisma:5`. Does not exist. |
| `lib/validations.ts` | Exists, empty, imported by nothing. |

---

## If you only do five things

1. **Commit `.env.example`** (item 1) — the documented install currently fails.
2. ~~**`PATCH /api/shares/[id]`** (item 7)~~ — done.
3. ~~**Stream downloads with `Range` support** (item 9).~~ Done.
4. **Rate-limit the unlock endpoint** (item 21) — `UNLOCK_FAIL` is already being
   logged; nothing acts on it.
5. **Handle `NOTIFY_DOWNLOAD`, or remove the option** (item 2) — a promise the
   UI makes and the worker drops.
