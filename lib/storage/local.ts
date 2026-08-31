import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

import type { ByteRange } from "@/lib/range";

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

  /**
   * `resolve` still runs synchronously, so a traversal attempt is refused
   * before anything is opened.
   *
   * The handle is opened eagerly rather than letting `createReadStream` open
   * lazily, so that a missing file rejects here instead of arriving later as
   * an `error` event on the stream. The download routes cannot do anything
   * useful with the late version: by the time the stream errors, the 200 and
   * its headers have already gone out.
   */
  async stream(key: string, range?: ByteRange): Promise<Readable> {
    const handle = await fs.open(this.resolve(key), "r");

    const stream = handle.createReadStream(
      range ? { start: range.start, end: range.end } : undefined,
    );

    // Belt and braces on the descriptor. `autoClose` should already do this,
    // but a leaked handle per abandoned download is the kind of fault that
    // only shows up as a dead box months later on someone else's hardware.
    // Closing twice is harmless; not closing once is not.
    stream.once("close", () => {
      handle.close().catch(() => {});
    });

    return stream;
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
