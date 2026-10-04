/**
 * Fixtures built in code for the tests that need real files — so the repo
 * carries no binary test assets, and each fixture says how it was made.
 */

/** A white image with black lines of text, drawn by sharp from SVG. */
export async function textImage(
  lines: string[],
  { width = 1000, lineHeight = 90 } = {},
): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const height = lineHeight * (lines.length + 1);
  const escaped = lines.map((line) =>
    line.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="white"/>
    ${escaped
      .map(
        (line, index) =>
          `<text x="40" y="${lineHeight * (index + 1)}" font-family="sans-serif" font-size="56" fill="black">${line}</text>`,
      )
      .join("")}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * A one-page PDF whose page is a single JPEG and nothing else — which is what
 * a scanner produces: no text layer, just the picture of the page.
 */
export async function scannedPdf(image: Buffer): Promise<Buffer> {
  return pdfOf([{ image }]);
}

type FixturePage = { image: Buffer } | { text: string };

/**
 * A PDF of the given pages, in order: each either a picture (a scan) or a
 * line of typed text in Helvetica (a text layer). A mix is what a report with
 * a few scanned pages pasted in looks like.
 */
export async function pdfOf(pages: FixturePage[]): Promise<Buffer> {
  const { default: sharp } = await import("sharp");

  // Object 1 the catalog, 2 the page tree, 3 the font; pages from 4 on.
  const objects: Buffer[] = [];
  const pageRefs: number[] = [];
  const add = (body: Buffer) => {
    objects.push(body);
    return objects.length;
  };

  add(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
  add(Buffer.alloc(0)); // the page tree, filled in once the pages are known
  add(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));

  for (const page of pages) {
    if ("text" in page) {
      const escaped = page.text.replace(/[\\()]/g, (char) => `\\${char}`);
      const content = Buffer.from(`BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`);
      const contents = add(
        Buffer.concat([
          Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
          content,
          Buffer.from("\nendstream"),
        ]),
      );
      pageRefs.push(
        add(
          Buffer.from(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contents} 0 R >>`,
          ),
        ),
      );
      continue;
    }

    const { data: jpeg, info } = await sharp(page.image)
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    const image = add(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
        ),
        jpeg,
        Buffer.from("\nendstream"),
      ]),
    );
    const content = Buffer.from(
      `q ${info.width} 0 0 ${info.height} 0 0 cm /Im0 Do Q`,
    );
    const contents = add(
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
        content,
        Buffer.from("\nendstream"),
      ]),
    );
    pageRefs.push(
      add(
        Buffer.from(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${info.width} ${info.height}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${contents} 0 R >>`,
        ),
      ),
    );
  }

  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`,
  );

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let length = parts[0].length;

  objects.forEach((body, index) => {
    offsets.push(length);
    const object = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      body,
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(object);
    length += object.length;
  });

  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(length),
    "%%EOF",
    "",
  ].join("\n");

  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}
