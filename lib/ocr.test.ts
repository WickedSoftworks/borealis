import { describe, expect, test } from "bun:test";
import { extractText } from "./extract";
import { cleanOcrText, ocrImage, ocrLanguages, ocrPdf } from "./ocr";
import { pdfOf, scannedPdf, textImage } from "./testing/fixtures";

describe("cleanOcrText", () => {
  test("drops lines with nothing readable and tidies the rest", () => {
    expect(
      cleanOcrText("  Invoice   48213 \n\n ~ ' . \n|||\n\nTotal:\t 120 EUR\n"),
    ).toBe("Invoice 48213\nTotal: 120 EUR");
  });

  test("keeps non-Latin text", () => {
    expect(cleanOcrText("Größe 12\nΑθήνα\n—")).toBe("Größe 12\nΑθήνα");
  });

  test("a photo's texture yields nothing", () => {
    expect(cleanOcrText(". , ' ` ~\n- _ =\n")).toBe("");
  });
});

describe("ocrLanguages", () => {
  test("English unless configured", () => {
    expect(ocrLanguages({})).toBe("eng");
    expect(ocrLanguages({ OCR_LANGUAGES: "eng+deu" })).toBe("eng+deu");
  });

  test("a malformed value falls back rather than failing every job", () => {
    expect(ocrLanguages({ OCR_LANGUAGES: "../etc" })).toBe("eng");
    expect(ocrLanguages({ OCR_LANGUAGES: "eng deu" })).toBe("eng");
  });
});

/*
  The real engine on real pixels, with the model bundled in node_modules — no
  network. Slow by unit-test standards (a few seconds each), which is the
  honest cost of knowing OCR works rather than that it was called.
*/
describe("recognition", () => {
  test(
    "reads the text in an image",
    async () => {
      const image = await textImage([
        "Invoice number 48213",
        "Aurora borealis",
      ]);
      const result = await ocrImage(image);

      expect(result.pages).toBe(1);
      expect(result.text).toContain("48213");
      expect(result.text.toLowerCase()).toContain("aurora");
    },
    { timeout: 60_000 },
  );

  test(
    "reads a scanned PDF's page image",
    async () => {
      const pdf = await scannedPdf(
        await textImage(["Quarterly report", "Reference 7719"]),
      );
      const result = await ocrPdf(pdf);

      expect(result.truncated).toBe(false);
      expect(result.text).toContain("7719");
      expect(result.text.toLowerCase()).toContain("quarterly");
    },
    { timeout: 60_000 },
  );

  test(
    "a mixed PDF keeps its typed pages and reads only the scanned one",
    async () => {
      const pdf = await pdfOf([
        { text: "Typed introduction about the Halvorsen account" },
        { image: await textImage(["Signed annex", "Reference 4471"]) },
      ]);

      const extracted = await extractText(
        async () => pdf,
        {
          name: "mixed.pdf",
          mimeType: "application/pdf",
          size: BigInt(pdf.length),
        },
        { ocr: true },
      );
      // The typed page is indexed at once, and OCR is still asked for.
      expect(extracted).toMatchObject({ ocr: "pdf" });
      expect("content" in extracted && extracted.content).toContain(
        "Halvorsen",
      );

      const result = await ocrPdf(pdf);
      expect(result.text).toContain("Halvorsen");
      expect(result.text).toContain("4471");
      expect(result.text.indexOf("Halvorsen")).toBeLessThan(
        result.text.indexOf("4471"),
      );
    },
    { timeout: 60_000 },
  );
});
