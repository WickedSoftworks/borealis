import type { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { StorageProvider } from "./provider";

export type S3Config = {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
};

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region ?? "us-east-1",
      endpoint: config.endpoint,
      // MinIO and most self-hosted S3 gateways need path-style addressing.
      forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            }
          : undefined,
    });
  }

  async upload(key: string, data: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }),
    );
  }

  async download(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    if (!result.Body) {
      throw new Error(`Empty body for storage key: ${key}`);
    }

    return Buffer.from(await result.Body.transformToByteArray());
  }

  /**
   * The SDK's `Body` union also covers browser runtimes (ReadableStream, Blob).
   * On Node it is always a Readable, which is why the cast is safe here and
   * would not be in shared code.
   */
  async stream(key: string): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    if (!result.Body) {
      throw new Error(`Empty body for storage key: ${key}`);
    }

    return result.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
