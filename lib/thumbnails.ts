import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { storage } from "@/lib/storage";

/**
 * Small WebP previews, drawn by the THUMBNAIL job after upload.
 *
 * Stored beside the original through the same StorageProvider, under
 * `thumb_<fileId>.webp` — a single path segment, like every other key, and a
 * prefix the storage reconciliation sweep recognises so it never mistakes one
 * for an orphan.
 *
 * Images only. A PDF's first page would need a renderer the container does not
 * carry, and a thumbnail that is wrong half the time is worse than an icon.
 * SVG is refused outright: rendering one means running an XML document from a
 * stranger through librsvg, and the preview is not worth that exposure.
 *
 * End-to-end encrypted files never get one — the server holds ciphertext — and
 * the interface says so instead of drawing an empty square.
 */

const DRAWABLE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/tiff",
  "image/heic",
  "image/heif",
]);

/** Past this the decode costs more than a thumbnail is worth. */
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

/**
 * A decompression bomb is a small file that decodes to a huge bitmap. sharp's
 * own ceiling is 268 megapixels; a thumbnail needs nowhere near that.
 */
const MAX_INPUT_PIXELS = 60_000_000;

export const THUMBNAIL_SIZE = 256;

export function canThumbnail(mimeType: string): boolean {
  return DRAWABLE.has(mimeType.toLowerCase());
}

export function thumbnailKeyFor(fileId: string): string {
  return `thumb_${fileId}.webp`;
}

export async function thumbnailJob(payload: { fileId: string }): Promise<void> {
  const file = await db.file.findUnique({
    where: { id: payload.fileId },
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
      size: true,
      isEncrypted: true,
      thumbnailKey: true,
    },
  });

  if (!file || file.thumbnailKey || file.isEncrypted) return;
  if (!canThumbnail(file.mimeType) || file.size > BigInt(MAX_SOURCE_BYTES)) {
    return;
  }

  // Imported here rather than at the top: sharp is a native module, and the
  // worker is the only code path that needs it. Every route that imports this
  // file for `canThumbnail` stays free of it.
  const { default: sharp } = await import("sharp");

  const source = await storage.download(file.storageKey);

  let image: Buffer;

  try {
    image = await sharp(source, {
      limitInputPixels: MAX_INPUT_PIXELS,
      // First frame only: an animated GIF becomes a still.
      animated: false,
    })
      // Honour the EXIF orientation, then drop the metadata — a phone photo's
      // GPS coordinates have no business in a preview a recipient can fetch.
      .rotate()
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 72 })
      .toBuffer();
  } catch (error) {
    // Not a failure worth retrying: the bytes are what they are. The file
    // keeps its icon, and the reason is in the log.
    log.info("thumbnail.undrawable", { fileId: file.id, error });
    return;
  }

  const key = thumbnailKeyFor(file.id);
  await storage.upload(key, image);

  // Scoped to rows still without one, so a duplicate job cannot overwrite a
  // key that is being served.
  const written = await db.file.updateMany({
    where: { id: file.id, thumbnailKey: null },
    data: { thumbnailKey: key },
  });

  if (written.count === 0) {
    // The file went away (or another job won) while we were drawing.
    await storage.delete(key).catch(() => {});
  }
}
