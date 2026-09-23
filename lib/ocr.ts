import path from "node:path";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { search } from "@/lib/search";
import { storage } from "@/lib/storage";

/**
 * Optical character recognition, for the files text extraction cannot read:
 * photographs of documents, screenshots, and PDFs made of page scans.
 *
 * tesseract.js runs Tesseract compiled to WebAssembly in a worker thread, so
 * there is no system package to install and no service to run beside the
 * app. The English model ships in the image (@tesseract.js-data/eng) and is
 * read from disk — left to its defaults tesseract.js fetches models from a
 * CDN at first use, which is a network call nobody asked for on a box that
 * may have no route out.
 *
 * It is its own job type, queued by EXTRACT_TEXT only when ordinary
 * extraction came back empty, because it is slow — seconds per page, where
 * extraction is milliseconds — and the checksum, thumbnail, and download
 * notification jobs should not wait behind it for anything that has a text
 * layer. On by default; `OCR=off` turns it off for a box that cannot spare
 * the CPU (`ocrEnabled`, lib/extract.ts, which also decides what is an image).
 *
 * What it is not: exact. OCR reads what it can, and a blurry photo yields
 * little or nothing. That is why the result only feeds search and is never
 * presented as the document's text.
 */

/** Largest image side handed to Tesseract. A 300 dpi A4 scan is 2480 × 3508. */
const MAX_SIDE = 3500;

/** Same decompression-bomb ceiling as thumbnails (lib/thumbnails.ts). */
const MAX_INPUT_PIXELS = 60_000_000;

/**
 * An image inside a PDF smaller than this is a logo, a rule, or an icon —
 * reading it costs time and yields noise.
 */
const MIN_PDF_IMAGE_PIXELS = 200 * 200;

const MAX_TEXT_LENGTH = 400_000;

/**
 * Tesseract's language codes, joined with `+` — `eng`, `eng+deu`. Anything
 * beyond English needs its `.traineddata.gz` in OCR_LANG_PATH; a malformed
 * value falls back to English rather than failing every job.
 */
export function ocrLanguages(
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env.OCR_LANGUAGES?.trim();
  return value && /^[a-z_]{3,}(\+[a-z_]{3,})*$/.test(value) ? value : "eng";
}

function maxPages(
  env: Record<string, string | undefined> = process.env,
): number {
  const configured = Number(env.OCR_MAX_PAGES);
  return Number.isInteger(configured) && configured > 0 ? configured : 30;
}

/** Where the models are read from: OCR_LANG_PATH, or the bundled English one. */
function langPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return (
    env.OCR_LANG_PATH?.trim() ||
    // The "best_int" build: the LSTM model only, quantised — the fastest of
    // Tesseract's published models for the accuracy, and the one the default
    // engine mode uses.
    path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "node_modules",
      "@tesseract.js-data",
      "eng",
      "4.0.0_best_int",
    )
  );
}

/**
 * Tidy Tesseract's output for indexing: trim each line, drop the lines with
 * no letter or digit in them (OCR of a photo's texture yields rows of stray
 * punctuation), and collapse the blank runs between blocks. Pure, so the
 * judgement is testable without a model.
 */
export function cleanOcrText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => /[\p{L}\p{N}]{2,}/u.test(line))
    .join("\n")
    .slice(0, MAX_TEXT_LENGTH);
}

type Sharp = typeof import("sharp")["default"];

async function loadSharp(): Promise<Sharp> {
  // Native module; imported on first use, as lib/thumbnails.ts does.
  const { default: sharp } = await import("sharp");
  return sharp;
}

/**
 * Normalise an image for recognition: first frame, EXIF orientation applied,
 * transparency flattened onto white (Tesseract reads a transparent PNG's
 * black-on-nothing as black-on-black), greyscale, and no larger than
 * MAX_SIDE. PNG out, which every Tesseract build reads.
 */
async function prepare(
  sharp: Sharp,
  input:
    | Buffer
    | {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        channels: 1 | 3 | 4;
      },
): Promise<Buffer> {
  const image = Buffer.isBuffer(input)
    ? sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, pages: 1 })
    : sharp(
        Buffer.from(
          input.data.buffer,
          input.data.byteOffset,
          input.data.byteLength,
        ),
        {
          raw: {
            width: input.width,
            height: input.height,
            channels: input.channels,
          },
          limitInputPixels: MAX_INPUT_PIXELS,
        },
      );

  return image
    .rotate()
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize({
      width: MAX_SIDE,
      height: MAX_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}

/**
 * Recognise a sequence of images with one Tesseract worker, terminated
 * afterwards whatever happens — a worker thread holds its model in memory
 * (tens of megabytes), and the queue runs rarely enough that keeping one warm
 * is not worth it.
 */
async function recognizeAll(images: AsyncIterable<Buffer>): Promise<string[]> {
  const tesseract = await import("tesseract.js");
  const createWorker = tesseract.createWorker ?? tesseract.default.createWorker;

  const worker = await createWorker(ocrLanguages(), undefined, {
    langPath: langPath(),
    gzip: true,
    // Read the model from langPath every time; the default caches a copy in
    // the working directory, which in the container is the app itself.
    cacheMethod: "none",
  });

  // Images carry no resolution Tesseract trusts — a PNG from sharp says 72,
  // pixels pulled out of a PDF say nothing — and it warns on every one. 300
  // is what a scan is and what its heuristics are tuned for.
  await worker.setParameters({ user_defined_dpi: "300" });

  try {
    const pages: string[] = [];

    for await (const image of images) {
      const { data } = await worker.recognize(image);
      pages.push(data.text);
    }

    return pages;
  } finally {
    await worker.terminate();
  }
}

export type OcrResult = {
  text: string;
  /** Pages read; for an image, 1. */
  pages: number;
  /** A PDF with more pages than OCR_MAX_PAGES: only the first were read. */
  truncated: boolean;
};

export async function ocrImage(buffer: Buffer): Promise<OcrResult> {
  const sharp = await loadSharp();
  const prepared = await prepare(sharp, buffer);

  const [text] = await recognizeAll(
    (async function* () {
      yield prepared;
    })(),
  );

  return { text: cleanOcrText(text ?? ""), pages: 1, truncated: false };
}

/**
 * A scanned PDF is a stack of page images. They are taken out of the PDF as
 * decoded pixels rather than by rendering each page — rendering needs a
 * canvas implementation, a second native module, and a scan's page is its
 * image anyway.
 */
export async function ocrPdf(buffer: Buffer): Promise<OcrResult> {
  const sharp = await loadSharp();
  const { extractImages, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));

  const limit = maxPages();
  const pageCount = Math.min(pdf.numPages, limit);

  async function* pageImages() {
    for (let page = 1; page <= pageCount; page++) {
      const images = await extractImages(pdf, page);

      for (const image of images) {
        if (image.width * image.height < MIN_PDF_IMAGE_PIXELS) continue;
        yield await prepare(sharp, image);
      }
    }
  }

  const texts = await recognizeAll(pageImages());

  return {
    text: cleanOcrText(texts.join("\n\n")),
    pages: pageCount,
    truncated: pdf.numPages > limit,
  };
}

/**
 * The OCR_FILE job. Queued by EXTRACT_TEXT (lib/jobs.ts) for an image, or a
 * PDF with no text layer, when OCR is on.
 *
 * A failure is recorded on the file and not retried: what makes OCR fail is
 * almost always the file — a corrupt image, an exotic PDF encoding — and
 * trying again three times only triples the CPU spent learning that.
 */
export async function ocrJob(payload: {
  fileId: string;
  kind: "image" | "pdf";
}) {
  const file = await db.file.findUnique({
    where: { id: payload.fileId },
    select: { id: true, storageKey: true, isEncrypted: true, deletedAt: true },
  });

  // Gone, trashed since, or ciphertext: nothing to read, nothing to record.
  if (!file || file.deletedAt || file.isEncrypted) return;

  const started = Date.now();

  try {
    const bytes = await storage.download(file.storageKey);
    const result =
      payload.kind === "pdf" ? await ocrPdf(bytes) : await ocrImage(bytes);

    log.info("ocr.done", {
      fileId: file.id,
      kind: payload.kind,
      pages: result.pages,
      characters: result.text.length,
      truncated: result.truncated,
      ms: Date.now() - started,
    });

    if (result.text) {
      await search.index(file.id, result.text);
      return;
    }

    await db.fileText.upsert({
      where: { fileId: file.id },
      create: {
        fileId: file.id,
        status: "SKIPPED",
        error: "no text found, including by OCR",
      },
      update: {
        status: "SKIPPED",
        error: "no text found, including by OCR",
        content: "",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    log.warn("ocr.failed", {
      fileId: file.id,
      kind: payload.kind,
      error: message,
    });

    await db.fileText.upsert({
      where: { fileId: file.id },
      create: {
        fileId: file.id,
        status: "FAILED",
        error: `OCR failed: ${message}`,
      },
      update: {
        status: "FAILED",
        error: `OCR failed: ${message}`,
        content: "",
      },
    });
  }
}
