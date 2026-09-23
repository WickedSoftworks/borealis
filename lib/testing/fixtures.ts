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
  const { default: sharp } = await import("sharp");
  const { data: jpeg, info } = await sharp(image)
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });

  const content = Buffer.from(
    `q ${info.width} 0 0 ${info.height} 0 0 cm /Im0 Do Q`,
  );

  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${info.width} ${info.height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from("\nendstream"),
    ]),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from("\nendstream"),
    ]),
  ];

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
