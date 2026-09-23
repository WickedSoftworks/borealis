import { DensityMeter } from "@/components/world/meter";
import { DataRow } from "@/components/world/panel";
import { formatBytes } from "@/lib/format";

/**
 * How much of an account's ceiling is used, drawn with the same instrument as
 * a link's caps — a quantity running out is the one thing this world is built
 * to show. With no ceiling, the figure is stated plainly instead of drawing a
 * meter against an invented maximum.
 */
export function QuotaMeter({
  used,
  trash,
  limit,
  cells = 20,
}: {
  used: number;
  trash: number;
  limit: number | null;
  cells?: number;
}) {
  if (limit === null) {
    return (
      <>
        <DataRow label="Stored">{formatBytes(used)}</DataRow>
        {trash > 0 && <DataRow label="In trash">{formatBytes(trash)}</DataRow>}
        <DataRow label="Limit">None</DataRow>
      </>
    );
  }

  const ratio = limit > 0 ? used / limit : 1;

  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      <DensityMeter
        label="Storage used"
        value={used}
        max={limit}
        cells={cells}
        tone={ratio >= 0.9 ? "alarm" : "normal"}
        readout={`${formatBytes(used)} of ${formatBytes(limit)}`}
      />
      {trash > 0 && (
        <p className="text-[0.6875rem] leading-relaxed text-ink-60">
          {formatBytes(trash)} of that is in the trash and still counts until it
          is emptied.
        </p>
      )}
    </div>
  );
}
