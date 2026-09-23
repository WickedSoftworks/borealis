import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { MIN_TEXT, type SearchParams, typeFilter } from "./params";
import type { SearchHit, SearchProvider, SearchResult } from "./provider";

/**
 * Full-text search over filenames and extracted document text.
 *
 * SQLite and Postgres diverge too far to paper over — LIKE versus tsvector —
 * so each decides what "matches" means, and they share everything else: the
 * filters, the ordering, and the paging. Both search only within one owner's
 * files; there is no cross-account search at any privilege level, because
 * "admins can delete a user's files" is not the same as "admins can read them".
 *
 * "Best match" puts filename matches ahead of contents-only matches, newest
 * first within each. It is done as two ranges concatenated rather than as one
 * computed sort, so the count and the pages are exact on both databases and a
 * file never appears on two pages or on none.
 */

type Where = Prisma.FileWhereInput;

const HIT_SELECT = {
  id: true,
  originalName: true,
  size: true,
  mimeType: true,
  createdAt: true,
  folderId: true,
  isEncrypted: true,
} as const;

type Row = {
  id: string;
  originalName: string;
  size: bigint;
  mimeType: string;
  createdAt: Date;
  folderId: string | null;
  isEncrypted: boolean;
};

function orderFor(
  sort: SearchParams["sort"],
): Prisma.FileOrderByWithRelationInput[] {
  switch (sort) {
    case "oldest":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "name":
      return [{ originalName: "asc" }, { id: "asc" }];
    case "largest":
      return [{ size: "desc" }, { id: "desc" }];
    case "smallest":
      return [{ size: "asc" }, { id: "asc" }];
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

/** Everything but the text: owner, liveness, and the filters. */
function baseWhere(
  ownerId: string,
  params: SearchParams,
  folderScope: string[] | null,
): Where {
  return {
    ownerId,
    deletedAt: null,
    AND: [
      ...(params.type ? [typeFilter(params.type)] : []),
      ...(folderScope ? [{ folderId: { in: folderScope } }] : []),
      ...(params.from ? [{ createdAt: { gte: params.from } }] : []),
      ...(params.to ? [{ createdAt: { lte: params.to } }] : []),
      ...(params.minBytes !== null ? [{ size: { gte: params.minBytes } }] : []),
      ...(params.maxBytes !== null ? [{ size: { lte: params.maxBytes } }] : []),
    ],
  };
}

function excerpt(content: string, query: string): string | null {
  const at = content.toLowerCase().indexOf(query.toLowerCase());

  if (at < 0) return content.slice(0, 160).replace(/\s+/g, " ").trim() || null;

  const from = Math.max(0, at - 60);
  const text = content
    .slice(from, from + 200)
    .replace(/\s+/g, " ")
    .trim();

  return `${from > 0 ? "…" : ""}${text}…`;
}

abstract class BaseSearch implements SearchProvider {
  async index(fileId: string, content: string) {
    await db.fileText.upsert({
      where: { fileId },
      create: { fileId, content, status: "DONE", extractedAt: new Date() },
      update: { content, status: "DONE", extractedAt: new Date(), error: null },
    });
  }

  async remove(fileId: string) {
    await db.fileText.deleteMany({ where: { fileId } });
  }

  /** The provider's meaning of "the filename matches". */
  protected abstract nameMatch(ownerId: string, text: string): Promise<Where>;

  /** The provider's meaning of "the contents match". */
  protected abstract contentMatch(
    ownerId: string,
    text: string,
  ): Promise<Where>;

  /** Excerpts for the given files, keyed by id. */
  protected abstract snippets(
    fileIds: string[],
    text: string,
  ): Promise<Map<string, string>>;

  async query(
    ownerId: string,
    params: SearchParams,
    folderScope: string[] | null,
  ): Promise<SearchResult> {
    const base = baseWhere(ownerId, params, folderScope);
    const text = params.text.length >= MIN_TEXT ? params.text : null;
    const { offset, limit } = params;

    // Filters only: an ordinary sorted listing of what they select.
    if (!text) {
      const [total, rows] = await Promise.all([
        db.file.count({ where: base }),
        db.file.findMany({
          where: base,
          orderBy: orderFor(
            params.sort === "relevance" ? "newest" : params.sort,
          ),
          skip: offset,
          take: limit,
          select: HIT_SELECT,
        }),
      ]);

      return { total, hits: rows.map((row) => this.hit(row, null, null)) };
    }

    const [name, content] = await Promise.all([
      this.nameMatch(ownerId, text),
      this.contentMatch(ownerId, text),
    ]);

    let rows: Row[];
    let total: number;

    if (params.sort === "relevance") {
      const nameWhere: Where = { AND: [base, name] };
      const contentOnlyWhere: Where = { AND: [base, content, { NOT: name }] };

      const [nameTotal, contentTotal] = await Promise.all([
        db.file.count({ where: nameWhere }),
        db.file.count({ where: contentOnlyWhere }),
      ]);

      total = nameTotal + contentTotal;

      const fromName =
        offset < nameTotal
          ? await db.file.findMany({
              where: nameWhere,
              orderBy: orderFor("newest"),
              skip: offset,
              take: limit,
              select: HIT_SELECT,
            })
          : [];

      const stillNeeded = limit - fromName.length;
      const fromContent =
        stillNeeded > 0
          ? await db.file.findMany({
              where: contentOnlyWhere,
              orderBy: orderFor("newest"),
              skip: Math.max(0, offset - nameTotal),
              take: stillNeeded,
              select: HIT_SELECT,
            })
          : [];

      rows = [...fromName, ...fromContent];
    } else {
      const where: Where = { AND: [base, { OR: [name, content] }] };

      [total, rows] = await Promise.all([
        db.file.count({ where }),
        db.file.findMany({
          where,
          orderBy: orderFor(params.sort),
          skip: offset,
          take: limit,
          select: HIT_SELECT,
        }),
      ]);
    }

    // Which of this page's rows matched by name, and which by contents, is
    // asked of the database rather than guessed from the row: the provider
    // decides what a match is, and a JS `includes` would disagree with a
    // stemmed full-text match every time.
    const ids = rows.map((row) => row.id);
    const [byName, byContent] = await Promise.all([
      db.file.findMany({
        where: { AND: [{ id: { in: ids } }, name] },
        select: { id: true },
      }),
      db.file.findMany({
        where: { AND: [{ id: { in: ids } }, content] },
        select: { id: true },
      }),
    ]);

    const nameIds = new Set(byName.map((row) => row.id));
    const contentIds = new Set(byContent.map((row) => row.id));
    const excerpts = await this.snippets([...contentIds], text);

    return {
      total,
      hits: rows.map((row) =>
        this.hit(
          row,
          nameIds.has(row.id) && contentIds.has(row.id)
            ? "both"
            : nameIds.has(row.id)
              ? "name"
              : contentIds.has(row.id)
                ? "content"
                : null,
          excerpts.get(row.id) ?? null,
        ),
      ),
    };
  }

  private hit(
    row: Row,
    matchedIn: SearchHit["matchedIn"],
    snippet: string | null,
  ): SearchHit {
    return {
      fileId: row.id,
      originalName: row.originalName,
      size: row.size,
      mimeType: row.mimeType,
      createdAt: row.createdAt,
      folderId: row.folderId,
      isEncrypted: row.isEncrypted,
      matchedIn,
      snippet,
    };
  }
}

class SqliteSearch extends BaseSearch {
  // LIKE rather than FTS5: the virtual table would need to be created and
  // kept in sync outside Prisma's migrations, and at self-hosted scale a scan
  // over one owner's documents is not the bottleneck. SQLite's LIKE ignores
  // ASCII case, which is what a person typing a name expects.
  protected async nameMatch(_ownerId: string, text: string): Promise<Where> {
    return { originalName: { contains: text } };
  }

  protected async contentMatch(_ownerId: string, text: string): Promise<Where> {
    return { text: { is: { status: "DONE", content: { contains: text } } } };
  }

  /** The window around the first match, cut in SQL so the text never ships whole. */
  protected async snippets(fileIds: string[], text: string) {
    if (fileIds.length === 0) return new Map<string, string>();

    const rows = await db.$queryRaw<Array<{ fileId: string; window: string }>>`
      SELECT "fileId",
             substr(content, max(1, instr(lower(content), lower(${text})) - 60), 240) AS window
        FROM "FileText"
       WHERE "fileId" IN (${Prisma.join(fileIds)})
    `;

    return new Map(
      rows.flatMap((row) => {
        const snippet = excerpt(row.window, text);
        return snippet ? [[row.fileId, snippet] as const] : [];
      }),
    );
  }
}

/** Escape LIKE's wildcards so a search for "100%" means the characters. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** Enough to page through; past this, a search is too broad to be useful. */
const MATCH_CAP = 10_000;

class PostgresSearch extends BaseSearch {
  // ILIKE for names, since Prisma's case-insensitive mode exists only on
  // Postgres and this client is generated for one provider at a time.
  protected async nameMatch(ownerId: string, text: string): Promise<Where> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "File"
       WHERE "ownerId" = ${ownerId}
         AND "deletedAt" IS NULL
         AND "originalName" ILIKE ${likePattern(text)} ESCAPE '\\'
       LIMIT ${MATCH_CAP}
    `;

    return { id: { in: rows.map((row) => row.id) } };
  }

  // websearch_to_tsquery accepts what a person actually types — quoted
  // phrases, OR, leading minus — instead of tsquery's own syntax.
  protected async contentMatch(ownerId: string, text: string): Promise<Where> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT f.id FROM "FileText" ft
        JOIN "File" f ON f.id = ft."fileId"
       WHERE f."ownerId" = ${ownerId}
         AND f."deletedAt" IS NULL
         AND ft.status = 'DONE'
         AND to_tsvector('english', ft.content) @@ websearch_to_tsquery('english', ${text})
       LIMIT ${MATCH_CAP}
    `;

    return { id: { in: rows.map((row) => row.id) } };
  }

  protected async snippets(fileIds: string[], text: string) {
    if (fileIds.length === 0) return new Map<string, string>();

    const rows = await db.$queryRaw<
      Array<{ fileId: string; snippet: string | null }>
    >`
      SELECT "fileId",
             ts_headline('english', content,
                         websearch_to_tsquery('english', ${text}),
                         'MaxWords=30, MinWords=10') AS snippet
        FROM "FileText"
       WHERE "fileId" IN (${Prisma.join(fileIds)})
    `;

    return new Map(
      rows.flatMap((row) =>
        // ts_headline marks matches with <b>…</b>, which the page would show
        // as literal tags — it renders text, not markup. Postgres refuses an
        // empty StartSel, so the markers are stripped here instead.
        row.snippet
          ? [
              [
                row.fileId,
                row.snippet
                  .replace(/<\/?b>/g, "")
                  .replace(/\s+/g, " ")
                  .trim(),
              ] as const,
            ]
          : [],
      ),
    );
  }
}

export const search: SearchProvider =
  process.env.DATABASE_PROVIDER === "postgresql"
    ? new PostgresSearch()
    : new SqliteSearch();

export type { SearchHit, SearchProvider, SearchResult };
