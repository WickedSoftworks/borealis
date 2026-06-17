import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";

import type { FileMetadata, StorageProvider } from "./provider";

export class LocalStorageProvider implements StorageProvider {
  private uploadDir: string;

  constructor(uploadDir = "./uploads") {
    this.uploadDir = uploadDir;
  }

  async upload(
    // biome-ignore lint/correctness/noUnusedFunctionParameters: it's required but not used in this implementation
    key: string,
    file: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<FileMetadata> {
    const id = uuid();

    const storagePath = path.join(this.uploadDir, id);

    await fs.writeFile(storagePath, file);

    return {
      id,
      filename,
      size: file.length,
      mimeType,
    };
  }

  async download(id: string): Promise<Buffer> {
    const storagePath = path.join(this.uploadDir, id);

    return fs.readFile(storagePath);
  }

  async delete(id: string): Promise<void> {
    const storagePath = path.join(this.uploadDir, id);

    await fs.unlink(storagePath);
  }

  async exists(id: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.uploadDir, id));
      return true;
    } catch {
      return false;
    }
  }
}
