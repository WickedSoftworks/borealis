# What to add to Borealis

An audit of the codebase on `feat/file-host`, listing what is missing, what is
half-built, and what is claimed but not implemented. Items are removed as they
ship; [`CHANGELOG.md`](../CHANGELOG.md) records what shipped.

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

### Search can't explain a missing file

`FileText` records why a file was not indexed — `"image — OCR is turned off on
this instance"`, `"no text found, including by OCR"`, `"file is too large to
index"` (`lib/extract.ts`, `lib/ocr.ts`) — and nothing in the interface shows
it. Someone who cannot find a scan by its contents has no way to learn whether
it was read and found empty, skipped, or is still waiting its turn.

**Add:** the status and reason beside a file in the vault, at least for files
that are not `DONE`.

### OCR reads a PDF only when it has no text at all

`lib/extract.ts` hands a PDF to OCR only when its text layer is empty, so a
document that is typed on some pages and scanned on others is indexed from its
typed pages alone.

**Add:** a per-page decision — OCR the pages whose text layer is empty.

---

## P2 — Operations and self-hosting

### Postgres full-text search has no index

`lib/search/index.ts` builds `to_tsvector` at query time; there is no GIN index
behind it, so content search on Postgres is a sequential scan of `FileText`.
Fine at a few thousand files, not at a few hundred thousand.

**Add:** a raw-SQL migration (Prisma will not generate it) creating a GIN index
on the expression the query uses, in the Postgres history only.

---

## P4 — Interface and recipient experience

- **No i18n.** Every string is hard-coded English. Recipients are strangers on
  the internet, which is the strongest case for translation any part of this
  product has. Translations need a speaker of each language to review them
  before they ship; a catalogue nobody has checked is worse than English.

---

## P5 — Codebase and contributor experience

- **Integration tests cover the public surface only.** `test/integration/`
  exercises the share routes, the unlock lockout, and the worker against the
  production build. The owner's side — sign-up through an invitation, a tus
  upload, quota refusal, the admin routes — is covered by unit tests of its
  policy and by hand, not end to end.
