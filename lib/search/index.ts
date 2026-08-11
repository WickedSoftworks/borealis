import { db } from "@/lib/db";
import type { SearchHit, SearchProvider } from "./provider";

/**
 * Full-text search over extracted document text.
 *
 * SQLite and Postgres diverge too far to paper over — FTS5 virtual tables
 * versus tsvector and GIN — so each gets its own implementation behind this
 * interface, exactly as storage does. Both search only within one owner's
 * files; there is no cross-account search at any privilege level, because
 * "admins can delete a user's files" is not the same as "admins can read them".
 */

function excerpt(content: string, query: string): string | null {
  const at = content.toLowerCase().indexOf(query.toLowerCase());

  if (at < 0) return content.slice(0, 160).trim() || null;

  const from = Math.max(0, at - 60);
  const text = content
    .slice(from, from + 200)
    .replace(/\s+/g, " ")
    .trim();

  return `${from > 0 ? "…" : ""}${text}…`;
}

class SqliteSearch implements SearchProvider {
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

  async search(
    ownerId: string,
    query: string,
    limit = 25,
  ): Promise<SearchHit[]> {
    // LIKE rather than FTS5: the virtual table would need to be created and
    // kept in sync outside Prisma's migrations, and at self-hosted scale a
    // scan over one owner's documents is not the bottleneck. The interface is
    // here so this can become FTS5 without touching callers.
    const rows = await db.fileText.findMany({
      where: {
        status: "DONE",
        content: { contains: query },
        file: { ownerId, deletedAt: null },
      },
      take: limit,
      select: {
        fileId: true,
        content: true,
        file: { select: { originalName: true } },
      },
    });

    return rows.map((row) => ({
      fileId: row.fileId,
      originalName: row.file.originalName,
      snippet: excerpt(row.content, query),
    }));
  }
}

class PostgresSearch extends SqliteSearch {
  override async search(
    ownerId: string,
    query: string,
    limit = 25,
  ): Promise<SearchHit[]> {
    // websearch_to_tsquery accepts what a person actually types — quoted
    // phrases, OR, leading minus — instead of tsquery's own syntax.
    const rows = await db.$queryRaw<
      Array<{ fileId: string; originalName: string; snippet: string }>
    >`
      SELECT ft."fileId"       AS "fileId",
             f."originalName"  AS "originalName",
             ts_headline('english', ft.content,
                         websearch_to_tsquery('english', ${query}),
                         'MaxWords=30, MinWords=10') AS snippet
        FROM "FileText" ft
        JOIN "File" f ON f.id = ft."fileId"
       WHERE f."ownerId" = ${ownerId}
         AND f."deletedAt" IS NULL
         AND ft.status = 'DONE'
         AND to_tsvector('english', ft.content)
             @@ websearch_to_tsquery('english', ${query})
       LIMIT ${limit}
    `;

    return rows.map((row) => ({ ...row, snippet: row.snippet ?? null }));
  }
}

export const search: SearchProvider =
  process.env.DATABASE_PROVIDER === "postgresql"
    ? new PostgresSearch()
    : new SqliteSearch();

export type { SearchHit, SearchProvider };
