import { encode } from "uqr";
import { cn } from "@/lib/utils";

/**
 * A QR code drawn on the same cell grid as the icons: one module, one filled
 * cell, crisp edges.
 *
 * The one place this world breaks its own palette, on purpose. Scanners —
 * phone cameras and authenticator apps both — are built for dark modules on a
 * light ground, and a phosphor-on-glass code in the dark theme fails on enough
 * of them to matter. So the code always sits on its own white cell with black
 * modules, whatever the register around it. Legibility of the one thing a
 * camera has to read outranks consistency of the frame.
 *
 * Rendered on the server where it can be, since the SVG is the whole result.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  /** What the code encodes, for a screen reader: "Link to this share". */
  label: string;
  className?: string;
}) {
  // Medium correction survives a smudged screen or a slightly cropped photo;
  // a border of four modules is the quiet zone the spec asks for.
  const { data, size } = encode(value, { ecc: "M", border: 4 });

  const cells: string[] = [];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y][x]) cells.push(`M${x} ${y}h1v1h-1z`);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn("block bg-white", className)}
    >
      <path d={cells.join("")} fill="#000" />
    </svg>
  );
}
