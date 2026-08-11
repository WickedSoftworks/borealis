"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { RAMP } from "./ramp";

/** Columns per letter needed before letterforms hold their stems and counters. */
const COLUMNS_PER_LETTER = 13;
const MIN_CELL = 3;

/**
 * Display type drawn by sampling, not by font size.
 *
 * The word is rasterised to an offscreen canvas, then each cell of a character
 * grid is sampled for coverage and replaced with the ramp glyph matching its
 * density. This is the world's actual mechanism — the letterform emerges from
 * the same alphabet the rest of the interface is built from — rather than an
 * image of one.
 *
 * The cell size is derived from the container rather than fixed: at a fixed
 * cell size a narrow viewport yields only a handful of columns per letter and
 * the word rasterises into unreadable static. `maxCellSize` caps how coarse it
 * gets on wide screens; the floor keeps it legible on a phone.
 *
 * The real word ships as accessible text; the glyph field is decorative and
 * hidden from assistive tech. Before hydration, and if canvas is unavailable,
 * the plain word renders instead, so the heading is never missing.
 */
export function GlyphText({
  children,
  maxCellSize = 6,
  className,
  weight = 700,
  as: Wrapper = "div",
}: {
  children: string;
  maxCellSize?: number;
  className?: string;
  weight?: number;
  /** Render as a heading where the word IS the page's heading. */
  as?: "div" | "h1";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState<{ rows: string[]; cell: number } | null>(
    null,
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let frame = 0;

    function render() {
      const element = containerRef.current;
      if (!element) return;

      const width = element.clientWidth;
      if (width <= 0) return;

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;

      // Enough columns for the letterforms to survive, whatever the width.
      const targetColumns = Math.max(8, children.length) * COLUMNS_PER_LETTER;
      const cellSize = Math.max(
        MIN_CELL,
        Math.min(maxCellSize, width / targetColumns),
      );

      const columns = Math.max(8, Math.floor(width / cellSize));
      const probeSize = 100;
      const fontFamily = getComputedStyle(element).fontFamily;

      context.font = `${weight} ${probeSize}px ${fontFamily}`;
      const measured = context.measureText(children);
      const scale = (columns * cellSize) / Math.max(1, measured.width);
      const fontSize = probeSize * scale;

      const height = Math.ceil(fontSize * 1.02);
      const gridRows = Math.max(4, Math.floor(height / cellSize));

      canvas.width = Math.ceil(columns * cellSize);
      canvas.height = Math.ceil(gridRows * cellSize);

      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = `${weight} ${fontSize}px ${fontFamily}`;
      context.textBaseline = "middle";
      context.fillStyle = "#fff";
      context.fillText(children, 0, canvas.height / 2);

      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const step = Math.max(1, Math.floor(cellSize / 3));
      const rows: string[] = [];

      for (let row = 0; row < gridRows; row++) {
        let line = "";

        for (let column = 0; column < columns; column++) {
          let total = 0;
          let samples = 0;

          for (let sy = 0; sy < cellSize; sy += step) {
            for (let sx = 0; sx < cellSize; sx += step) {
              const x = Math.floor(column * cellSize + sx);
              const y = Math.floor(row * cellSize + sy);

              if (x >= canvas.width || y >= canvas.height) continue;

              total += data[(y * canvas.width + x) * 4] / 255;
              samples++;
            }
          }

          const coverage = samples > 0 ? total / samples : 0;
          line +=
            coverage < 0.06
              ? " "
              : RAMP[
                  Math.min(
                    RAMP.length - 1,
                    Math.round(coverage * (RAMP.length - 1)),
                  )
                ];
        }

        rows.push(line);
      }

      setGrid({ rows, cell: cellSize });
    }

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    });

    observer.observe(container);
    frame = requestAnimationFrame(render);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [children, maxCellSize, weight]);

  return (
    <Wrapper ref={containerRef} className={cn("w-full", className)}>
      <span className="sr-only">{children}</span>

      {grid ? (
        <pre
          aria-hidden="true"
          className="w-full overflow-hidden font-mono leading-[0.86] tracking-[0.02em] text-ink-90 select-none"
          style={{ fontSize: `${grid.cell}px` }}
        >
          {grid.rows.join("\n")}
        </pre>
      ) : (
        <span
          aria-hidden="true"
          className="block font-mono font-bold uppercase tracking-[-0.02em] text-ink-90 text-[clamp(2rem,9vw,5rem)]"
        >
          {children}
        </span>
      )}
    </Wrapper>
  );
}
