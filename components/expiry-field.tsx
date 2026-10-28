"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  EXPIRY_PRESETS,
  type ExpiryInput,
  type ExpiryPresetId,
  isExpired,
  resolveExpiry,
} from "@/lib/shares/expiry";
import { cn } from "@/lib/utils";

type ExpiryMode = "keep" | "preset" | "duration" | "until";

const CHIP =
  "h-8 rounded-full border border-line px-3 text-[13px] font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg aria-pressed:border-transparent aria-pressed:bg-accent-soft aria-pressed:text-accent";

function absolute(date: Date) {
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The expiry control.
 *
 * This is the decision that bounds everything else about a link, so it is one
 * component shared by every link-making surface: presets for the common cases,
 * a custom duration, or an explicit calendar date. It reports an ExpiryInput
 * upward and never resolves anything itself — the server does that.
 *
 * Editing an existing link needs a fourth state. Only the resolved `expiresAt`
 * is stored, never the preset that produced it, so there is nothing to prefill
 * the chips with — and a field that defaulted to "1 week" would silently push
 * out the expiry of every link opened for some unrelated reason. `current`
 * turns on a "Keep current" chip that is selected by default and reports null,
 * meaning "leave the expiry out of the request entirely".
 */
export function ExpiryField({
  legend = "Stops working",
  current,
  defaultPreset = "1w",
  onChange,
}: {
  legend?: string;
  /** Pass the link's existing expiry to offer "keep it as it is". */
  current?: { expiresAt: string | null };
  /**
   * The chip chosen on mount. Read once, like an input's defaultValue: to
   * change it from outside, remount the field with a new `key`.
   */
  defaultPreset?: ExpiryPresetId;
  /** Must be referentially stable — a `useState` setter, or memoised. */
  onChange: (expiry: ExpiryInput | null) => void;
}) {
  const [mode, setMode] = useState<ExpiryMode>(current ? "keep" : "preset");
  const [preset, setPreset] = useState<ExpiryPresetId>(defaultPreset);
  const [durationValue, setDurationValue] = useState("36");
  const [durationUnit, setDurationUnit] = useState<
    "minutes" | "hours" | "days" | "weeks"
  >("hours");
  const [untilDate, setUntilDate] = useState("");

  // The resolved date depends on this browser's clock and zone, so it is
  // written only after mount; the Send page renders this on the server first.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Memoised on the primitives so the object stays identical between renders;
  // rebuilding it every render would make the effect below fire in a loop.
  const expiry = useMemo<ExpiryInput | null>(() => {
    if (mode === "keep") {
      return null;
    }

    if (mode === "duration") {
      return {
        mode: "duration",
        value: Number(durationValue),
        unit: durationUnit,
      };
    }

    if (mode === "until") {
      return { mode: "until", date: new Date(untilDate).toISOString() };
    }

    return { mode: "preset", preset };
  }, [mode, preset, durationValue, durationUnit, untilDate]);

  useEffect(() => {
    onChange(expiry);
  }, [expiry, onChange]);

  const currentExpiresAt =
    current?.expiresAt === undefined || current.expiresAt === null
      ? null
      : new Date(current.expiresAt);

  /**
   * What the current selection resolves to, in words. Null means it never
   * expires. Computed with the same resolver the server uses, so the preview
   * cannot drift from the value that actually gets stored.
   */
  const resolvedLabel = (() => {
    if (mode === "keep") {
      return currentExpiresAt === null ? null : absolute(currentExpiresAt);
    }

    try {
      const resolved = resolveExpiry(expiry as ExpiryInput);

      if (resolved === null) return null;

      return absolute(resolved);
    } catch {
      return "once you pick a valid date";
    }
  })();

  const keepingAnExpiredLink =
    mode === "keep" && isExpired(currentExpiresAt) && currentExpiresAt !== null;

  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      {/*
        States what the chosen option actually resolves to, beside the
        legend, so the date is read with the choice rather than after it.
      */}
      <legend className="mb-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="label-caps">{legend}</span>
        <span aria-live="polite" className="data text-fg-muted">
          {resolvedLabel === null
            ? "only when you revoke it"
            : !mounted
              ? ""
              : keepingAnExpiredLink
                ? `expired ${resolvedLabel}`
                : resolvedLabel}
        </span>
      </legend>

      <div className="flex flex-wrap gap-1.5">
        {current && (
          <button
            type="button"
            aria-pressed={mode === "keep"}
            onClick={() => setMode("keep")}
            className={CHIP}
          >
            Keep current
          </button>
        )}

        {EXPIRY_PRESETS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={mode === "preset" && preset === option.id}
            onClick={() => {
              setMode("preset");
              setPreset(option.id);
            }}
            className={CHIP}
          >
            {option.label}
          </button>
        ))}

        {(["duration", "until"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => setMode(option)}
            className={cn(CHIP, "border-dashed border-line-strong")}
          >
            {option === "duration" ? "Custom…" : "Pick a date…"}
          </button>
        ))}
      </div>

      {mode === "duration" && (
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            aria-label="Duration"
            value={durationValue}
            onChange={(event) => setDurationValue(event.target.value)}
            className="w-24"
          />
          <select
            aria-label="Duration unit"
            value={durationUnit}
            onChange={(event) =>
              setDurationUnit(event.target.value as typeof durationUnit)
            }
            className="h-10 rounded-lg border border-field-edge bg-paper px-3 text-base text-fg sm:text-sm"
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
            <option value="weeks">weeks</option>
          </select>
        </div>
      )}

      {mode === "until" && (
        <Input
          type="datetime-local"
          aria-label="Stops working on"
          value={untilDate}
          onChange={(event) => setUntilDate(event.target.value)}
          className="max-w-64"
          required
        />
      )}

      {/*
        "No end date" is the setting most likely to be picked without
        thinking, on a product whose entire thesis is the leash, so it says
        what it means.
      */}
      {mounted && keepingAnExpiredLink ? (
        <p className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-[13px] leading-relaxed text-fg">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-warn"
            strokeWidth={1.75}
          />
          This link has expired. Pick a new end to bring it back.
        </p>
      ) : (
        resolvedLabel === null && (
          <p className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-[13px] leading-relaxed text-fg">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warn"
              strokeWidth={1.75}
            />
            With no end date, this link keeps working until you revoke it.
          </p>
        )
      )}
    </fieldset>
  );
}
