import fs from "node:fs/promises";
import path from "node:path";

import type { StorageProvider } from "./provider";

export class LocalStorageProvider implements StorageProvider {
  private uploadDir: string;

  constructor(uploadDir = process.env.STORAGE_PATH ?? "./uploads") {
    this.uploadDir = path.resolve(uploadDir);
  }

  /**
   * Resolve `key` inside the upload directory, refusing anything that escapes
   * it. Storage keys are generated server-side, but this is the last line of
   * defence if a key ever reaches here from user input.
   */
  private resolve(key: string): string {
    const target = path.resolve(this.uploadDir, key);

    if (
      target !== this.uploadDir &&
      !target.startsWith(this.uploadDir + path.sep)
    ) {
      throw new Error(`Invalid storage key: ${key}`);
    }

    return target;
  }

  async upload(key: string, data: Buffer): Promise<void> {
    const target = this.resolve(key);

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }

  async download(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
