import type { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { ByteRange } from "@/lib/range";

import type { StorageProvider, StoredObject } from "./provider";

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
   *
   * A range becomes a `Range` header on the GET, so the bucket sends only the
   * slice — the bytes never cross the wire, which is the difference between a
   * seek costing a few kilobytes and costing an object.
   *
   * `send()` is awaited, so a missing key rejects here rather than on the
   * stream, which is what the interface promises callers.
   */
  async stream(key: string, range?: ByteRange): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
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

  /** Paged, a thousand keys at a time, so a large bucket never sits in memory. */
  async *list(): AsyncIterable<StoredObject> {
    let token: string | undefined;

    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          ContinuationToken: token,
        }),
      );

      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;

        yield {
          key: object.Key,
          size: object.Size ?? 0,
          modifiedAt: object.LastModified ?? new Date(0),
        };
      }

      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}
