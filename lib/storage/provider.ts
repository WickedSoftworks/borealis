export interface FileMetadata {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
}

export interface StoredFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface StorageProvider {
  upload(
    key: string,
    file: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<FileMetadata>;

  download(key: string): Promise<Buffer>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;
}
