# Inline preview for share recipients

Design for roadmap item 3 — `viewOnly` shares currently give the recipient a
filename and a byte count and nothing else. This adds an inline previewer for
images, PDFs, and plain text on the share page at `app/s/[token]`.

Status: approved 2026-08-24. Supersedes the sketch in `docs/roadmap.md` item 3,
which proposed a `?disposition=inline` variant of the download route; see
"Approach" for why that was rejected.

## Context

`Share.viewOnly`'s own schema comment reads *"Stream a preview but refuse
download."* The refusal half exists — `lib/shares/guard.ts` returns `VIEW_ONLY`
→ 403 for any byte-serving request. The streaming half was never built. The
share page renders a `StateTag` reading "View only" where the download button
would be and stops.

Three pieces of the plumbing already exist and are unused:

- `contentDisposition()` in `lib/http.ts` takes `"attachment" | "inline"`.
  Nothing passes `"inline"`.
- `ShareAccess.action` is documented as `"VIEW" | "DOWNLOAD" | "UNLOCK_FAIL" |
  "UPLOAD"`. Nothing writes `VIEW`.
- `Share.isE2E` is documented as *"server cannot preview, scan, or index it."*

## Decisions

These were settled before design and are not open for re-derivation during
implementation.

| Question | Decision |
|---|---|
| What may the iframe render? | **PDF only.** The iframe exists solely as the PDF viewport. Arbitrary HTML and SVG are never served inline. |
| What does a preview cost? | **Nothing.** No `downloadCount` increment, no `egressUsedBytes` increment. |
| Which shares preview? | **All of them.** `viewOnly` subtracts the download button; it does not gate the previewer. |

### Accepted consequence

Because previews are free and serve the real bytes, `maxDownloads` and
`viewOnly` become **advisory for previewable types**. A recipient who can see an
image or PDF can save it, and nothing meters that. This was raised and
explicitly accepted. It is inherent to showing someone a file, not an artifact
of this design.

Two follow-ups are therefore recorded but out of scope: softening the share
page's "Downloads left" copy for shares whose files are all previewable, and
metering preview egress if a future operator needs `egressLimitBytes` to hold
on view-only shares.

## Non-goals

- Video and audio preview. Not requested, and they are the two types that would
  make `Range` support a hard prerequisite.
- Office formats, EPUB, archives.
- Preview of E2E-encrypted files. Requires client-side decrypt to a blob URL;
  see "Encrypted files" for what recipients see instead.
- Owner-side preview in the dashboard. The same classifier will serve it later.
- Streaming and `Range` (roadmap item 9). Independent fix; see "Relationship to
  item 9".

## Approach

A dedicated preview route, rather than a `disposition` parameter on the
download route.

The roadmap's `?disposition=inline` suggestion was rejected because previews are
free. A query parameter on the metered route would be a documented switch for
"free, unmetered, `viewOnly`-exempt download" — one `if` away from defeating
both `maxDownloads` and `viewOnly`, on the single route where the accounting
lives. Two postures behind one parameter is also materially harder to test.

Signed short-lived preview URLs were considered and deferred: the share token is
already the capability, so the extra machinery has no payer until user content
moves to a separate origin (roadmap item 22).

## Architecture

Four units, each independently testable.

### 1. `lib/preview.ts` — the classifier

Pure, no React, no I/O. The single source of truth for what is previewable.

```ts
export type PreviewKind = "image" | "pdf" | "text";

/** Returns the kind, and the Content-Type the server will send for it. */
export function classifyPreview(
  mimeType: string,
): { kind: PreviewKind; contentType: string } | null;
```

Allowlist, matched against `mimeType` only:

| Kind | Accepted `mimeType` | Content-Type sent |
|---|---|---|
| `image` | `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif` | the matched allowlist constant |
| `pdf` | `application/pdf` | `application/pdf` |
| `text` | `text/plain`, `text/markdown`, `text/csv`, `application/json`, `application/xml` | `text/plain; charset=utf-8` |

Anything else returns `null`.

Three deliberate properties:

- **`image/svg+xml` is absent.** SVG is a script execution vector and the iframe
  decision was PDF-only.
- **The Content-Type is re-derived, never echoed.** The stored `mimeType` is
  attacker-controlled — it comes from the uploader's tus metadata. The route
  sends the allowlist's value for the matched kind, so an HTML payload stored as
  `text/plain` is served as `text/plain` and cannot execute.
- **No extension fallback.** `lib/extract.ts`'s `isPlainText()` deliberately
  falls back to filename extensions, because guessing wrong there costs a search
  index entry. Guessing wrong here costs a security boundary, so preview matches
  on MIME alone. The two functions stay separate; do not merge them.

### 2. `lib/shares/guard.ts` — an explicit intent

The current `isDownload?: boolean` cannot express three postures. Replace it:

```ts
export type ShareIntent = "metadata" | "preview" | "download";

export type GuardOptions = {
  intent?: ShareIntent;   // default "metadata"
  bytes?: bigint;
  unlockToken?: string;
};
```

Check matrix — every cell is deliberate:

| Check | `metadata` | `preview` | `download` |
|---|---|---|---|
| `NOT_FOUND` / `REVOKED` | yes | yes | yes |
| `EXPIRED` | yes | yes | yes |
| `VIEW_ONLY` | no | **no** | yes |
| `DOWNLOAD_LIMIT` | no | **no** | yes |
| `EGRESS_LIMIT` | no | **no** | yes |
| `PASSWORD_REQUIRED` | yes | yes | yes |

The existing ordering comment stays true and stays enforced: revoked and
missing both return 404 so a token cannot be probed, and the password check runs
**last** so an expired or exhausted share never becomes a password oracle. A
preview request on a password-protected share without a valid unlock cookie gets
`PASSWORD_REQUIRED`, exactly like a download.

Both call sites are updated: `app/api/s/[token]/download/[fileId]/route.ts:44`
passes `intent: "download"`, and `app/s/[token]/page.tsx:29` passes nothing and
inherits `"metadata"` — its current behaviour.

### 3. `app/api/s/[token]/preview/[fileId]/route.ts` — the byte route

`runtime = "nodejs"`. Mirrors the download route's structure, including its
share-membership check (*"the file must actually belong to this share"*) and its
cookie parsing for the unlock token.

Order of operations:

1. Look up share by token → 404 if absent.
2. Look up `ShareItem` for `(shareId, fileId)` → 404 if absent or `deletedAt`.
3. `guardShare(share, { intent: "preview", unlockToken })` → on failure return
   `GUARD_STATUS[reason]` with the `X-Borealis-Reason` header, matching the
   download route.
4. Reject `file.isEncrypted` → **415**.
5. `classifyPreview(file.mimeType)` → `null` gives **415**.
6. Enforce `MAX_PREVIEW_BYTES` (32 MB, matching `MAX_EXTRACT_BYTES`) → **413**.
7. Serve.

Response headers:

```
Content-Type:              <from the classifier, never from the DB>
Content-Length:            <byte length>
Content-Disposition:       inline; filename="…"     (via contentDisposition)
X-Content-Type-Options:    nosniff
Content-Security-Policy:   default-src 'none'; img-src 'self' data:; object-src 'none'; sandbox
Cache-Control:             private, no-store
```

The CSP is defence in depth. The allowlist should already make it unreachable,
but it is one header and it turns a classifier mistake from an incident into a
blank frame. `no-store` keeps share bytes out of shared caches, which matters
for a link whose whole point is that access is revocable.

**One thing to verify during implementation:** a response CSP applies to
documents, not to subresources — so it is inert for `<img>` and for the `fetch`
behind the text view, and live only for the PDF iframe's document. `sandbox`
there may break Chrome's built-in PDF viewer, which runs as an internal
extension. Check a real PDF renders before keeping it. If it does not, drop
`sandbox` for the `pdf` kind only and keep `default-src 'none'; object-src
'none'`; a response typed `application/pdf` under `nosniff` cannot script the
parent origin, so the boundary holds without it. Do not "fix" a blank frame by
adding `allow-scripts`.

Step 6 exists because previews auto-load. Without a ceiling, opening a share
page pulls every file into server memory at once — the item 9 problem, but
triggered by page load rather than by a click.

### 4. `components/share-preview.tsx` — the viewer

Client component. Opened from a file row via the existing
`components/world/dialog.tsx` (`DialogContent` takes `title` and an optional
`description`, so the filename goes in the title).

Renders by kind:

- `image` → `<img>` with `max-h`/`max-w` constraints and the filename as `alt`.
- `pdf` → `<iframe>` at a fixed viewport height, `title` set for a11y. The
  browser's built-in PDF viewer does the work; no PDF.js dependency.
- `text` → `fetch` the route, render into `<pre>` with `overflow-auto`. Capped
  client-side at 200 KB of rendered text with a truncation notice, so a 30 MB
  log does not lock the tab.

The dialog's `max-w-lg` is too narrow for a document; the preview dialog passes
a wider `className`.

## Share page changes

`app/s/[token]/page.tsx` computes `classifyPreview(file.mimeType)` per file
server-side — it is a pure function and the page is already a server component,
so no client round-trip decides what is previewable.

The per-row control block currently branches `viewOnly` → `exhausted` →
`isEncrypted` → download button. It becomes:

- Previewable and not encrypted → a "View" control, always.
- Then, independently: `viewOnly` → nothing further; `exhausted` → the existing
  "No downloads left" tag; `isEncrypted` → `EncryptedDownload`; otherwise the
  "Get" button.

So `viewOnly` stops being the first branch and becomes what it is — the absence
of a download affordance. A `viewOnly` share of a `.zip` still shows the "View
only" tag, since there is nothing to view and the recipient is owed the reason.

## Encrypted files

`share.isE2E` / `file.isEncrypted` files get no "View" control and a short line
saying the server cannot read them — consistent with the existing E2E copy on
the page, which already explains that the server is *"handing you bytes it
cannot read itself."* The route returns 415 for them regardless, so the UI and
the boundary agree.

## Accounting and audit

No `downloadCount` increment. No `egressUsedBytes` increment.

A `ShareAccess` row with `action: "VIEW"` is written, carrying `bytesServed` for
visibility even though it is not metered, plus `ipAddress` and `userAgent` like
the download path. Written in `after()` so it never delays the response.

**Throttle:** at most one `VIEW` row per `(shareId, fileId, ipAddress)` per 10
minutes. A page with eight previewable images would otherwise write eight rows
on every load, and the dashboard access log shows only 12 entries
(`app/dashboard/page.tsx:47`) — unthrottled previews would push every real
download off the owner's only window onto the audit trail.

Implemented as a `findFirst` for a recent matching `VIEW` row before the insert,
which rides the existing `@@index([shareId, createdAt])`. Both statements run
inside `after()`, so the extra read never touches response latency. The race
between two simultaneous previews writing two rows is acceptable — this is log
hygiene, not a limit.

`notifyOnDownload` does **not** fire on preview. It says download.

## Error handling

| Condition | Status | Recipient sees |
|---|---|---|
| Guard failure | per `GUARD_STATUS` | The page-level closed-link state already handles expiry and revocation; the dialog shows a short failure line. |
| Not previewable | 415 | No "View" control is rendered, so this is reachable only by direct URL. |
| Encrypted | 415 | No control rendered; copy explains why. |
| Over 32 MB | 413 | "Too large to preview — download it instead." |
| Storage read failure | 500 | "This file could not be opened." |

The dialog never renders a raw status code.

## Testing

TDD. Tests first, and the guard tests before the guard change.

- **`lib/shares/guard.test.ts` — new file.** The guard is the most
  security-critical function in the app and currently has no test at all. Cover
  every `GuardFailure` against all three intents, asserting the matrix above:
  notably that `preview` passes a `viewOnly` share, passes an exhausted one,
  passes one over its egress cap, and still fails a revoked, expired, or
  password-locked one. Include the ordering guarantees — an expired *and*
  password-locked share returns `EXPIRED`, not `PASSWORD_REQUIRED`.
- **`lib/preview.test.ts` — new file.** Every allowlisted MIME maps to its kind;
  `image/svg+xml`, `text/html`, and `application/octet-stream` return `null`;
  the returned `contentType` never equals an un-allowlisted input.
- **Route tests** for the preview route: 404 for a file not in the share, 401
  without an unlock cookie on a password share, 415 for encrypted and for
  unsupported types, 413 over the cap, and 200 with the correct headers on the
  happy path — asserting specifically that `Content-Type` is the classifier's
  value and not the stored `mimeType`.

Run `bun test`, `bun run typecheck`, and `bun run lint` before claiming done.

## Relationship to item 9

Roadmap item 9 lists streaming as blocking preview. With video and audio out of
scope it is not a blocker: images, PDFs, and text under a 32 MB ceiling are fine
buffered, and the ceiling bounds the exposure that item 9 addresses in general.

When item 9 lands, this route should adopt `stream(key, range?)` and emit
`Accept-Ranges` — browsers' PDF viewers issue range requests and will use them.
The `MAX_PREVIEW_BYTES` cap can then rise or go away. Nothing in this design
blocks that; the route is the only thing that changes.

## Files touched

| File | Change |
|---|---|
| `lib/preview.ts` | new — classifier and allowlist |
| `lib/preview.test.ts` | new |
| `lib/shares/guard.ts` | `isDownload` → `intent` |
| `lib/shares/guard.test.ts` | new |
| `app/api/s/[token]/preview/[fileId]/route.ts` | new |
| `app/api/s/[token]/download/[fileId]/route.ts` | pass `intent: "download"` |
| `app/s/[token]/page.tsx` | per-row View control, restructured branch |
| `components/share-preview.tsx` | new — the viewer dialog |
