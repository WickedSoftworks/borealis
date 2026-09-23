import type { SearchParams } from "./params";

export type SearchHit = {
  fileId: string;
  originalName: string;
  size: bigint;
  mimeType: string;
  createdAt: Date;
  folderId: string | null;
  isEncrypted: boolean;
  /** Where the text matched: the filename, the extracted contents, or both. */
  matchedIn: "name" | "content" | "both" | null;
  /** A short excerpt around the match, when the backend can produce one. */
  snippet: string | null;
};

export type SearchResult = {
  /** Every match, not just this page. */
  total: number;
  hits: SearchHit[];
};

export interface SearchProvider {
  /** Create or replace the index entry for a file's extracted text. */
  index(fileId: string, content: string): Promise<void>;

  /** Remove a file from the index. */
  remove(fileId: string): Promise<void>;

  /**
   * Search one owner's live files by name and contents, with filters, one
   * page at a time. `folderScope` is the folder and its descendants when the
   * search is limited to a folder, already resolved by the caller.
   */
  query(
    ownerId: string,
    params: SearchParams,
    folderScope: string[] | null,
  ): Promise<SearchResult>;
}
