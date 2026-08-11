export type SearchHit = {
  fileId: string;
  originalName: string;
  /** A short excerpt around the match, when the backend can produce one. */
  snippet: string | null;
};

export interface SearchProvider {
  /** Create or replace the index entry for a file's extracted text. */
  index(fileId: string, content: string): Promise<void>;

  /** Remove a file from the index. */
  remove(fileId: string): Promise<void>;

  /** Full-text search across one owner's files. */
  search(ownerId: string, query: string, limit?: number): Promise<SearchHit[]>;
}
