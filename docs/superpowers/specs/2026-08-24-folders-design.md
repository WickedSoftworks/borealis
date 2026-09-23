# Folders

Design for roadmap item 6: folder CRUD, a tree and breadcrumb in the dashboard,
moving files between folders, and sharing a whole folder.

Audited against `feat/file-host` @ `c3bd546`.

## Why this is not just CRUD

`Folder` is a complete Prisma model that nothing uses. The only reference in the
application is `lib/tus.ts`, which reads a `folderId` out of client-supplied tus
metadata and writes it to the `File` row without checking who owns it. That is
inert today because no folders exist; it becomes a live IDOR the moment this
ships, so roadmap item 20 is folded into this work rather than left for later.

The harder half is share resolution. Today a share is a flat list of files, and
two places assume it:

- `app/api/s/[token]/download/[fileId]/route.ts` proves membership with
  `db.shareItem.findFirst({ where: { shareId, fileId } })`
- `app/s/[token]/page.tsx` walks `share.items[].file`

Neither can see through a folder. Fixing them independently guarantees drift
between the page that *shows* what is in a share and the route that *decides*
what may leave it — and the second one is a security boundary.

## Decisions

| Question | Decision |
|---|---|
| Do folder shares track later additions? | **Live.** `ShareItem.folderId` is resolved per request. |
| Subfolders? | **Recursive, structure preserved** on the recipient page. |
| E2E files inside a shared folder? | **Shown locked.** Keys cannot be pre-computed for files that do not exist yet. |
| Dashboard navigation | **Tree** at `lg` and above, **breadcrumb + folder rows** below. |
| Moving files | **Drag and drop** via `@dnd-kit/core`, plus its keyboard sensor. |
| Deleting a folder | **Trashes the whole subtree**, restorable together. |

### Live shares and the truncated-link message

A live folder share can gain a file after the link was sent. If that file is
E2E-encrypted, its key was never in the URL fragment, so the recipient sees the
existing "key missing" state — which today means *your link arrived cut short*.

Left alone this erodes the one message that matters when a link really is
truncated. The share page therefore distinguishes the two using
`file.createdAt > share.createdAt`: a file uploaded after the share was created
was necessarily added later, and gets "added after this link was made — ask the
sender for a new link" instead of the truncation warning.

## Data model

**No migration.** `Folder` already carries `parentId` (self-relation),
`ownerId`, `deletedAt`, and indexes on `ownerId` and `parentId`;
`ShareItem.folderId` and its `@@unique([shareId, folderId])` are already there.

Deliberately **not** adding `@@unique([ownerId, parentId, name])`. `parentId` is
null at the root and both SQLite and Postgres treat NULLs as distinct in a
unique index, so the constraint would silently not apply to root-level folders —
exactly the per-provider divergence `models.prisma:3` warns about. Duplicate
sibling names are rejected in the API layer, where both providers behave alike.

## Modules

### `lib/folders.ts`

Split the way `lib/purge.ts` was split from `lib/trash.ts`: the tree arithmetic
is pure and unit-tested without a database; only the thin wrappers touch Prisma.

Pure, over a plain array of folder rows:

- `buildTree(rows)` — adjacency list to nested nodes
- `pathTo(rows, id)` — root-to-node ancestry, for the breadcrumb
- `descendantsOf(rows, id)` — the subtree, for delete and share resolution
- `wouldCycle(rows, moved, newParent)` — move guard

Two invariants these enforce, because nothing in the schema does: a **depth cap**
(`MAX_FOLDER_DEPTH`) and a **visited set**. `Folder` is a self-referencing tree
with no constraint preventing a cycle, and a cycle inside a recursive resolver
is an infinite loop in a request handler.

Database-touching: `folderTree(ownerId)`, `trashFolderTree`,
`restoreFolderTree`, `assertOwnedFolder(folderId, ownerId)`.

### `lib/shares/contents.ts`

One resolver, two consumers, so the page and the security boundary cannot
disagree.

- `shareContents(shareId)` — the nested structure the recipient page renders
- `shareIncludesFile(shareId, fileId)` — the download route's gate

Both filter `deletedAt: null` at every level, so a file inside a trashed folder
is unreachable through a live link. Resolution costs O(depth) queries, not one
per file: direct file items, then folder items, then a bounded descent
collecting folder ids, then a single `findMany` over `folderId: { in: ids }`.

## Routes

| Route | Purpose |
|---|---|
| `POST /api/folders` | create (`name`, `parentId?`) |
| `PATCH /api/folders/[id]` | rename and/or reparent, cycle-guarded |
| `POST /api/folders/[id]/delete` | trash the subtree |
| `POST /api/folders/[id]/restore` | restore the subtree |
| `POST /api/files/move` | bulk move `fileIds` into a folder |

Every one scopes by `ownerId` **inside the query** rather than checking first,
copying `restoreFile`: no window between check and write, and a request aimed at
someone else's folder simply matches nothing and 404s.

`POST /api/shares` gains `folderIds`; `fileIds: z.array().min(1)` relaxes to
"at least one of `fileIds` or `folderIds`".

`lib/tus.ts` gains an `assertOwnedFolder` call inside the transaction that
already exists there, falling back to null — roadmap item 20.

## Interface

Desktop `≥lg` gets `components/folder-tree.tsx` beside the file list. Below that
breakpoint, `components/folder-breadcrumb.tsx` with subfolders as rows above
files. Both are drop targets.

`app/dashboard/page.tsx` takes `?folder=<id>`. Per Next 16's `page.md`,
`searchParams` is a `Promise` and must be awaited. Scoping the file query to one
folder also dents roadmap item 13, since the dashboard stops loading every file
on every render.

`components/file-table.tsx` gains folder rows, draggable file rows, and a Move
action bound to the multi-select it already has. `@dnd-kit/core` 6.3.1 declares
`react: >=16.8.0`; only `core` is needed, since nothing is reordered. Its
keyboard sensor is why a separate "Move to…" menu is not also required.

## Testing

`lib/folders.test.ts` covers the pure tree functions, with cycles, depth, and
orphaned parents as explicit cases.

`lib/shares/contents.test.ts` covers the resolver's reach via the extracted pure
`expandSharedFolders`: a subfolder is reached, a sibling branch is not, a
trashed folder contributes nothing (not even its still-live children), a folder
the owner does not have is ignored, and a cyclic tree terminates.

What that does **not** cover is the Prisma layer underneath — that
`scopeFilter` really does exclude trashed files, and that `in: []` matches
nothing. Those need database fixtures, and this repo has no harness for them;
every existing test is a pure unit test. Worth building, out of scope here.

Roadmap P5 notes nothing tested the share guard; `lib/shares/guard.test.ts` has
since appeared. These follow the same shape.

## Known risks

- **Surprise disclosure.** Moving a file into a shared folder publishes it. The
  move confirmation must say so when the destination is inside a live share.
- **Concurrency.** Two other sessions are editing this tree; `app/dashboard/page.tsx`
  is the overlap. No migration here, so the schema is not contended.
