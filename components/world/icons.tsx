import { cn } from "@/lib/utils";

/**
 * Icons drawn on the same cell grid as the type.
 *
 * Each mark is composed of whole cells on an 8x8 lattice so it sits in the
 * monospace rhythm instead of floating over it. No outlines, no stroke weights
 * — presence is a filled cell, exactly like the ramp.
 */

type IconProps = { className?: string; title?: string };

const CELL = 1;

function Mark({
  cells,
  className,
  title,
}: IconProps & { cells: Array<[number, number]> }) {
  return (
    <svg
      viewBox="0 0 8 8"
      className={cn("size-4", className)}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="currentColor"
      shapeRendering="crispEdges"
    >
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={CELL} height={CELL} />
      ))}
    </svg>
  );
}

const box = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];

  for (let x = x0; x <= x1; x++) {
    cells.push([x, y0], [x, y1]);
  }

  for (let y = y0 + 1; y < y1; y++) {
    cells.push([x0, y], [x1, y]);
  }

  return cells;
};

export const IconFile = (props: IconProps) => (
  <Mark
    {...props}
    cells={[...box(1, 0, 6, 7), [5, 1], [5, 2], [3, 3], [4, 3], [3, 5], [4, 5]]}
  />
);

export const IconFolder = (props: IconProps) => (
  <Mark
    {...props}
    cells={[...box(0, 1, 7, 6), [1, 0], [2, 0], [3, 0], [3, 1]]}
  />
);

export const IconUpload = (props: IconProps) => (
  <Mark
    {...props}
    cells={[
      [3, 0],
      [4, 0],
      [2, 1],
      [5, 1],
      [1, 2],
      [6, 2],
      [3, 1],
      [4, 1],
      [3, 2],
      [4, 2],
      [3, 3],
      [4, 3],
      [3, 4],
      [4, 4],
      [0, 6],
      [1, 6],
      [2, 6],
      [3, 6],
      [4, 6],
      [5, 6],
      [6, 6],
      [7, 6],
    ]}
  />
);

export const IconDownload = (props: IconProps) => (
  <Mark
    {...props}
    cells={[
      [3, 4],
      [4, 4],
      [2, 3],
      [5, 3],
      [1, 2],
      [6, 2],
      [3, 0],
      [4, 0],
      [3, 1],
      [4, 1],
      [3, 2],
      [4, 2],
      [3, 3],
      [4, 3],
      [0, 6],
      [1, 6],
      [2, 6],
      [3, 6],
      [4, 6],
      [5, 6],
      [6, 6],
      [7, 6],
    ]}
  />
);

export const IconLock = (props: IconProps) => (
  <Mark
    {...props}
    cells={[
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [1, 1],
      [6, 1],
      [1, 2],
      [6, 2],
      ...box(0, 3, 7, 7),
      [3, 5],
      [4, 5],
    ]}
  />
);

export const IconClock = (props: IconProps) => (
  <Mark
    {...props}
    cells={[
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [1, 1],
      [6, 1],
      [0, 2],
      [7, 2],
      [0, 3],
      [7, 3],
      [0, 4],
      [7, 4],
      [1, 5],
      [6, 5],
      [2, 6],
      [3, 6],
      [4, 6],
      [5, 6],
      [3, 2],
      [3, 3],
      [4, 3],
    ]}
  />
);

export const IconShare = (props: IconProps) => (
  <Mark
    {...props}
    cells={[
      [6, 0],
      [7, 0],
      [6, 1],
      [7, 1],
      [0, 3],
      [1, 3],
      [0, 4],
      [1, 4],
      [6, 6],
      [7, 6],
      [6, 7],
      [7, 7],
      [2, 2],
      [3, 2],
      [4, 1],
      [5, 1],
      [2, 5],
      [3, 5],
      [4, 6],
      [5, 6],
    ]}
  />
);

export const IconTrash = (props: IconProps) => (
  <Mark
    {...props}
    cells={[
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
      [6, 1],
      [7, 1],
      [1, 2],
      [6, 2],
      [1, 3],
      [6, 3],
      [1, 4],
      [6, 4],
      [1, 5],
      [6, 5],
      [1, 6],
      [6, 6],
      [2, 7],
      [3, 7],
      [4, 7],
      [5, 7],
      [3, 3],
      [4, 3],
      [3, 5],
      [4, 5],
    ]}
  />
);

export const IconCheck = (props: IconProps) => (
  <Mark
    {...props}
    cells={[
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 5],
      [4, 4],
      [5, 3],
      [6, 2],
      [7, 1],
    ]}
  />
);

export const IconClose = (props: IconProps) => (
  <Mark
    {...props}
    cells={[
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
      [6, 1],
      [5, 2],
      [3, 4],
      [2, 5],
      [1, 6],
    ]}
  />
);

export const IconPlus = (props: IconProps) => (
  <Mark
    {...props}
    cells={[
      [3, 1],
      [4, 1],
      [3, 2],
      [4, 2],
      [3, 3],
      [4, 3],
      [3, 4],
      [4, 4],
      [3, 5],
      [4, 5],
      [3, 6],
      [4, 6],
      [1, 3],
      [2, 3],
      [5, 3],
      [6, 3],
      [1, 4],
      [2, 4],
      [5, 4],
      [6, 4],
    ]}
  />
);
