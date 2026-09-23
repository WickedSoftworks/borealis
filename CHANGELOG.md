# Changelog

Notable changes to Borealis. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); there are no numbered
releases yet, so everything is under **Unreleased**, newest work first.

## Unreleased

### Security

- **Collection links no longer open the send routes.** A reverse share's token
  was accepted by `/s/<token>` and the share download route, which exposed the
  files other people had uploaded through it. Both now require a send share.
- Share passwords lock after five wrong attempts, for a minute and then
  doubling to fifteen. The lock belongs to the link, is checked before the
  password hash runs, and ignores attempts made while locked.
- Rate limits on sign-in, sign-up, two-step codes, password reset, passkey
  sign-in, share unlock, invitation redemption, uploads, downloads, and test
  mail, stored in the database. `RATE_LIMIT=off` disables them.
- `TRUST_PROXY` takes a hop count or a list of proxy CIDRs as well as
  true/false, and `false` no longer trusts `X-Real-IP`. better-auth reads the
  client address from a header only the server writes, so its limiter and its
  session records follow the same policy.
- A content security policy on every page (HSTS and `upgrade-insecure-requests`
  only over https), and a sandboxing, no-script policy with `nosniff` on every
  served file.
- Per-share IP allow lists, and an instance-wide deny list (`DENIED_IPS`).
- An audit log of administrators' actions: bans, role and quota changes,
  account and file deletions, settings changes, job retries.
- A client-supplied upload `folderId` is kept only if the folder is the
  uploader's.
- Optional ClamAV scanning (`CLAMAV_HOST`); a flagged file is withheld from
  every public route.

### Added

- **License**: the GNU Affero General Public License v3, `AGPL-3.0-only`
  ([`LICENSE`](LICENSE)).
- **Passkeys.** Add, name, and remove them on the account page; sign in from
  the sign-in page's button or browser autofill. Only passkeys that verify the
  person (PIN or biometric) are accepted, since they skip the two-step code.
- **Two-step sign-in** with an authenticator app, with single-use backup codes.
- **Account page**: name, email change (confirmed from the old address when it
  was verified), password change, active sessions with sign-out, and account
  deletion with everything in it.
- **OCR.** Images and scanned PDFs are read by Tesseract, in-process with the
  English model bundled, and become searchable. `OCR=off` disables it;
  `OCR_LANGUAGES`, `OCR_LANG_PATH`, and `OCR_MAX_PAGES` tune it.
- Text extraction from XLSX, PPTX, OpenDocument, EPUB, RTF, and email, besides
  plain text, PDF, and DOCX.
- **Previews** of images, PDFs, and text files, for owners and on share pages
  (view-only shares included), and **thumbnails** in the vault and on share
  pages.
- **"Get all"**: one streamed ZIP of a share's readable files, with an exact
  size, counted as one download; and bulk download from the vault.
- **Download notifications** are now sent (at most ten an hour per link).
- **Storage quotas**: per upload (`MAX_UPLOAD_SIZE`), per account
  (`DEFAULT_QUOTA`, overridable per user), and per instance
  (`STORAGE_CEILING`), refused before any bytes are accepted.
- **Admin → Settings**: instance name, storage limits, audit retention, denied
  addresses, and SMTP with a test message, changeable without a restart. The
  SMTP password is encrypted at rest.
- **Admin → Jobs** (failures with their errors, retry, discard) and **Admin →
  Storage** (a daily check for stored objects no file points at).
- **Activity page**: the full access log with filters and CSV export.
- Search results are paged with a total, filter by type, size, date, and
  folder, and sort by relevance, name, date, or size.
- The vault is paginated and sortable, with bulk move and delete, rename,
  folder upload, paste to upload, a queue with speed, time left, pause,
  resume, and resuming after a dropped connection, and a first-run guide.
- QR codes for share links, a description field when creating a share, and
  the IP allow list in the share dialogs.
- A screen/paper theme switch on every page, applied before first paint.
- `bun run root backup` and `root restore`: a consistent SQLite snapshot and
  the stored files in a plain directory with a manifest.
- Prometheus metrics at `/api/metrics` behind `METRICS_TOKEN`; structured logs
  (`LOG_FORMAT=json`, `LOG_LEVEL`); server errors POSTed to
  `ERROR_WEBHOOK_URL`.
- An optional `clamav` service in `docker-compose.yml`.
- CI (typecheck, lint, unit tests, build, integration tests, both migration
  histories migrated from empty and diffed against the schema, the container
  image), Dependabot, `CONTRIBUTING.md`, and this file.
- Integration tests (`bun run test:integration`) that run the production
  build on a throwaway database: share routes, the unlock lockout, the sweep,
  and OCR.

### Changed

- Audit-log retention is configurable (`AUDIT_RETENTION_DAYS`, default 30).
- Periodic work runs through a database lease, so several processes can share
  one database without duplicating the sweep; jobs stuck mid-run are
  recovered.
- Unfinished uploads are removed after `UPLOAD_EXPIRY_HOURS` (default 24).
- Deleting a file also removes its thumbnail and upload sidecars.
- Line endings are normalised to LF (`.gitattributes`).
- `lib/validations.ts`, empty and unused, is gone; enum-like values live in
  `lib/constants.ts`.

### Fixed

- **tus's own upload expiry must never run.** `@tus/file-store` never updates
  the offset in an upload's sidecar, so its `deleteExpired()` treats every
  finished upload older than the window as abandoned and deletes it. It is
  replaced by a sweep that checks the bytes on disk and skips anything a file
  row names, with a regression test.
- Postgres migrations lacked the `Invite` table, so every sign-up failed on a
  fresh Postgres instance; SQLite lacked the checksum index. A repair
  migration fixes both, safely on an already-patched database.
- `docker-compose.yml` did not parse: an unquoted `: ` in the
  `BETTER_AUTH_SECRET` message made YAML reject the whole file.
- The container image could not be built or started:
  - it installed with `npm install`, which ignores `bun.lock`, so it picked up
    better-auth 1.7 and failed to compile — it now installs from the lockfile;
  - the migration step could not load `prisma.config.ts`
    (`Cannot find module 'prisma/config'`);
  - `borealis-root` crashed on start (`Dynamic require of "node:path"`);
  - a Windows checkout's CRLF entrypoint died with "No such file or
    directory".
- sharp's libvips and tesseract's WebAssembly cores were missing from the
  standalone output, so thumbnails (and OCR) could not work in the container.
  Local runs hid it by loading them from the project's `node_modules`.
- A backup taken in the container with no directory given was written outside
  the data volume; `BACKUP_DIR` is now `/app/data/backups` there.
- The README's Docker invitation command ran a script and a tool the image does
  not ship; it is `borealis-root invite --admin`.
- Admins no longer see a download button for other people's files that could
  only fail.
- Session addresses show as compact IPv6 with their /64 mask, not as
  expanded zeros.
