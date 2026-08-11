export interface StorageProvider {
  /** Persist `data` under `key`. The caller owns key generation. */
  upload(key: string, data: Buffer): Promise<void>;

  download(key: string): Promise<Buffer>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;
}
