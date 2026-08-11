import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./provider";
import { S3StorageProvider } from "./s3";

function createStorage(): StorageProvider {
  if (process.env.STORAGE_DRIVER !== "s3") {
    return new LocalStorageProvider();
  }

  const bucket = process.env.S3_BUCKET;

  if (!bucket) {
    throw new Error('STORAGE_DRIVER is "s3" but S3_BUCKET is not set.');
  }

  return new S3StorageProvider({
    bucket,
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });
}

export const storage = createStorage();
export type { StorageProvider };
