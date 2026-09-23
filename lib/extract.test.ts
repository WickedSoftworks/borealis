import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { extractText, formatOf } from "./extract";
import { emailToText } from "./extract/email";
import { rtfToText } from "./extract/rtf";
import { decodeEntities, elementText, markupToText } from "./extract/text";
import { scannedPdf, textImage } from "./testing/fixtures";
import { planZip, zipStream } from "./zip/write";

/** Build a real (stored) archive with the given entries. */
async function archive(files: Record<string, string>): Promise<Buffer> {
  const plan = planZip(
    Object.entries(files).map(([name, body]) => ({
      name,
      size: BigInt(Buffer.byteLength(body)),
      modifiedAt: new Date(0),
      open: async () => Readable.from([Buffer.from(body)]),
    })),
  );

  const chunks: Buffer[] = [];
  for await (const chunk of zipStream(plan)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const meta = (
  name: string,
  mimeType = "application/octet-stream",
  size = 100n,
) => ({
  name,
  mimeType,
  size,
});

describe("markup helpers", () => {
  test("decodes named and numeric entities", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#233; &#x263A; &bogus;")).toBe(
      "a & b <c> é ☺ &bogus;",
    );
  });

  test("keeps paragraph breaks and drops scripts", () => {
    expect(
      markupToText(
        "<html><head><title>x</title></head><body><h1>Title</h1><p>One</p><script>alert(1)</script><p>Two &amp; three</p></body></html>",
      ),
    ).toBe("Title\nOne\nTwo & three");
  });

  test("takes only the named element's text", () => {
    expect(
      elementText(
        '<a:p><a:t>Hello</a:t><a:rPr b="1"/><a:t>world</a:t></a:p>',
        "a:t",
      ),
    ).toBe("Hello world");
  });
});

describe("formatOf", () => {
  test("prefers the declared type, falls back to the extension", () => {
    expect(formatOf("application/pdf", "x.bin")).toBe("pdf");
    expect(formatOf("application/octet-stream", "Budget.XLSX")).toBe("xlsx");
    expect(formatOf("application/zip", "book.epub")).toBe("epub");
    expect(formatOf("text/csv", "data.csv")).toBe("text");
    expect(formatOf("image/png", "scan.png")).toBe("image");
    expect(formatOf("application/octet-stream", "IMG_0042.JPG")).toBe("image");
    expect(formatOf("image/svg+xml", "logo.svg")).toBeNull();
    expect(formatOf("video/mp4", "clip.mp4")).toBeNull();
  });
});

describe("extractText", () => {
  test("never loads a file it has no extractor for", async () => {
    let loaded = false;
    const result = await extractText(
      async () => {
        loaded = true;
        return Buffer.alloc(0);
      },
      meta("clip.mp4", "video/mp4"),
    );

    expect(result).toEqual({ skipped: "no extractor for video/mp4" });
    expect(loaded).toBe(false);
  });

  test("an image is handed to OCR without being loaded here", async () => {
    let loaded = false;
    const load = async () => {
      loaded = true;
      return Buffer.alloc(0);
    };

    expect(
      await extractText(load, meta("scan.png", "image/png"), { ocr: true }),
    ).toEqual({ ocr: "image" });
    expect(
      await extractText(load, meta("scan.png", "image/png"), { ocr: false }),
    ).toEqual({ skipped: "image — OCR is turned off on this instance" });
    expect(loaded).toBe(false);
  });

  test("a PDF with no text layer goes to OCR, or says why not", async () => {
    const pdf = await scannedPdf(await textImage(["Page one"]));
    const load = async () => pdf;
    const pdfMeta = meta("scan.pdf", "application/pdf", BigInt(pdf.length));

    expect(await extractText(load, pdfMeta, { ocr: true })).toEqual({
      ocr: "pdf",
    });
    expect(await extractText(load, pdfMeta, { ocr: false })).toEqual({
      skipped:
        "no embedded text (likely a scan — OCR is turned off on this instance)",
    });
  });

  test("never loads a file over the size cap", async () => {
    let loaded = false;
    const result = await extractText(
      async () => {
        loaded = true;
        return Buffer.alloc(0);
      },
      meta("big.txt", "text/plain", 64n * 1024n * 1024n),
    );

    expect(result).toEqual({ skipped: "file is too large to index" });
    expect(loaded).toBe(false);
  });

  test("an empty text file is skipped, not indexed as nothing", async () => {
    expect(
      await extractText(
        async () => Buffer.from("   "),
        meta("a.txt", "text/plain"),
      ),
    ).toEqual({ skipped: "file is empty" });
  });

  test("XLSX: sheet names, shared strings, inline strings", async () => {
    const buffer = await archive({
      "xl/workbook.xml":
        '<workbook><sheets><sheet name="Q3 budget" sheetId="1"/></sheets></workbook>',
      "xl/sharedStrings.xml":
        "<sst><si><t>Invoice</t></si><si><r><t>Acme</t></r><r><t> Ltd</t></r></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet><c t="inlineStr"><is><t>inline note</t></is></c></worksheet>',
    });

    const result = await extractText(async () => buffer, meta("q3.xlsx"));
    expect(result).toEqual({
      content: "Q3 budget\nInvoice\nAcme\nLtd\ninline note",
    });
  });

  test("PPTX: slides in order, then notes", async () => {
    const buffer = await archive({
      "ppt/slides/slide10.xml": "<p:sld><a:t>tenth</a:t></p:sld>",
      "ppt/slides/slide2.xml": "<p:sld><a:t>second</a:t></p:sld>",
      "ppt/notesSlides/notesSlide1.xml":
        "<p:notes><a:t>say this</a:t></p:notes>",
    });

    const result = await extractText(async () => buffer, meta("deck.pptx"));
    expect(result).toEqual({ content: "second\n\ntenth\n\nsay this" });
  });

  test("ODT: the body, not the styles", async () => {
    const buffer = await archive({
      "content.xml":
        '<office:document-content><office:automatic-styles><style:style style:name="P1"/></office:automatic-styles><office:body><office:text><text:h>Heading</text:h><text:p>Body &amp; soul</text:p></office:text></office:body></office:document-content>',
    });

    const result = await extractText(async () => buffer, meta("notes.odt"));
    expect(result).toEqual({ content: "Heading\nBody & soul" });
  });

  test("EPUB: every chapter", async () => {
    const buffer = await archive({
      "OEBPS/ch1.xhtml":
        "<html><body><p>It was a dark night.</p></body></html>",
      "OEBPS/ch2.xhtml": "<html><body><p>The end.</p></body></html>",
      "OEBPS/content.opf": "<package/>",
    });

    const result = await extractText(async () => buffer, meta("novel.epub"));
    expect(result).toEqual({ content: "It was a dark night.\n\nThe end." });
  });

  test("a corrupt archive is a skip with a reason, not a crash", async () => {
    const result = await extractText(
      async () => Buffer.from("not a zip"),
      meta("broken.docx"),
    );

    expect("skipped" in result && result.skipped).toContain(
      "extraction failed",
    );
  });
});

describe("rtfToText", () => {
  test("keeps text, breaks paragraphs, drops tables and destinations", () => {
    const rtf =
      "{\\rtf1\\ansi{\\fonttbl{\\f0 Times;}}{\\colortbl;\\red0\\green0\\blue0;}" +
      "{\\*\\generator Word;}\\f0 Hello\\par World \\'e9t\\'e9 \\u8364?5\\par}";

    expect(rtfToText(rtf)).toBe("Hello\nWorld été €5");
  });

  test("escaped braces and backslashes are text", () => {
    expect(rtfToText("{\\rtf1 a \\{ b \\} c \\\\ d}")).toBe("a { b } c \\ d");
  });
});

describe("emailToText", () => {
  test("headers first, then the plain alternative", () => {
    const eml = [
      "From: Sam <sam@example.com>",
      "To: you@example.com",
      "Subject: =?UTF-8?B?w4l0w6kgcGxhbnM=?=",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Caf=C3=A9 at noon=",
      "?",
      "--b1",
      "Content-Type: text/html",
      "",
      "<p>ignored</p>",
      "--b1--",
    ].join("\r\n");

    const text = emailToText(eml);

    expect(text).toContain("Subject: Été plans");
    expect(text).toContain("From: Sam <sam@example.com>");
    expect(text).toContain("Café at noon?");
    expect(text).not.toContain("ignored");
  });

  test("an HTML-only message is stripped to text", () => {
    const eml = [
      "Subject: hi",
      "Content-Type: text/html",
      "",
      "<p>Hello <b>there</b></p>",
    ].join("\n");

    expect(emailToText(eml)).toBe("Subject: hi\n\nHello there");
  });

  test("attachments are skipped", () => {
    const eml = [
      "Subject: files",
      'Content-Type: multipart/mixed; boundary="m"',
      "",
      "--m",
      "Content-Type: text/plain",
      "",
      "see attached",
      "--m",
      "Content-Type: text/plain",
      'Content-Disposition: attachment; filename="x.txt"',
      "",
      "SECRET ATTACHMENT BODY",
      "--m--",
    ].join("\n");

    const text = emailToText(eml);
    expect(text).toContain("see attached");
    expect(text).not.toContain("SECRET");
  });
});
