import type { Readable } from "node:stream";

export interface StorageProvider {
  /** Persist `data` under `key`. The caller owns key generation. */
  upload(key: string, data: Buffer): Promise<void>;

  download(key: string): Promise<Buffer>;

  /**
   * Read `key` as a stream.
   *
   * Prefer this over `download` for anything whose size is not known to be
   * small: `download` buffers the entire object, so a 4 GB file costs 4 GB of
   * heap. Errors on a missing key may surface on the stream rather than from
   * this promise, since the underlying handles open lazily.
   */
  stream(key: string): Promise<Readable>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;
}
