import type { Readable } from "node:stream";

import type { ByteRange } from "@/lib/range";

export interface StorageProvider {
  /** Persist `data` under `key`. The caller owns key generation. */
  upload(key: string, data: Buffer): Promise<void>;

  download(key: string): Promise<Buffer>;

  /**
   * Read `key` as a stream, optionally only the bytes in `range`.
   *
   * Prefer this over `download` for anything whose size is not known to be
   * small: `download` buffers the entire object, so a 4 GB file costs 4 GB of
   * heap.
   *
   * `range` is inclusive at both ends, matching HTTP — and matching what
   * `createReadStream` and S3 both take, so no translation happens on the way
   * down. Slicing belongs here rather than after the fact: reading 4 GB to
   * hand back 1 MB of it would defeat the point.
   *
   * A missing key rejects this promise; it does not surface later as an error
   * on the stream. Callers serving HTTP depend on that, because a response's
   * status cannot be taken back once its first byte has gone out — a failure
   * discovered mid-stream can only truncate the download, never become a 404.
   * Implementations must therefore open eagerly.
   */
  stream(key: string, range?: ByteRange): Promise<Readable>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  /**
   * Every object in the store, in no particular order.
   *
   * For the reconciliation sweep, which is the only caller: it compares what
   * is stored against what the database points at, so it needs the whole set
   * and must not load it at once — a bucket can hold millions of keys.
   */
  list(): AsyncIterable<StoredObject>;
}

export type StoredObject = {
  key: string;
  size: number;
  modifiedAt: Date;
};
