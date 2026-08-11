"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  EXPIRY_PRESETS,
  type ExpiryInput,
  resolveExpiry,
} from "@/lib/shares/expiry";

type ExpiryMode = "preset" | "duration" | "until";

const CHIP_ACTIVE =
  "bg-ink-100 px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-ground";
const CHIP_IDLE =
  "border border-dotted border-ink-40 px-2.5 py-1 text-[0.625rem] uppercase tracking-[0.16em] text-ink-60 transition-colors hover:border-ink-80 hover:text-ink-90";

/**
 * The expiry control.
 *
 * This is the decision that bounds everything else about a link, so it is one
 * component shared by every link-making surface: presets for the common cases,
 * a custom duration, or an explicit calendar date. It reports an ExpiryInput
 * upward and never resolves anything itself — the server does that.
 */
export function ExpiryField({
  legend = "Expires",
  onChange,
}: {
  legend?: string;
  /** Must be referentially stable — a `useState` setter, or memoised. */
  onChange: (expiry: ExpiryInput) => void;
}) {
  const [mode, setMode] = useState<ExpiryMode>("preset");
  const [preset, setPreset] = useState("1w");
  const [durationValue, setDurationValue] = useState("36");
  const [durationUnit, setDurationUnit] = useState<
    "minutes" | "hours" | "days" | "weeks"
  >("hours");
  const [untilDate, setUntilDate] = useState("");

  // Memoised on the primitives so the object stays identical between renders;
  // rebuilding it every render would make the effect below fire in a loop.
  const expiry = useMemo<ExpiryInput>(() => {
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

    return { mode: "preset", preset: preset as never };
  }, [mode, preset, durationValue, durationUnit, untilDate]);

  useEffect(() => {
    onChange(expiry);
  }, [expiry, onChange]);

  /**
   * What the current selection resolves to, in words. Null means it never
   * expires. Computed with the same resolver the server uses, so the preview
   * cannot drift from the value that actually gets stored.
   */
  const resolvedLabel = (() => {
    try {
      const resolved = resolveExpiry(expiry);

      if (resolved === null) return null;

      return resolved.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return "once you pick a valid date";
    }
  })();

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
        {legend}
      </legend>

      <div className="flex flex-wrap gap-1">
        {EXPIRY_PRESETS.map((option) => {
          const active = mode === "preset" && preset === option.id;

          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setMode("preset");
                setPreset(option.id);
              }}
              className={active ? CHIP_ACTIVE : CHIP_IDLE}
            >
              {option.label}
            </button>
          );
        })}

        {(["duration", "until"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => setMode(option)}
            className={mode === option ? CHIP_ACTIVE : CHIP_IDLE}
          >
            {option === "duration" ? "Custom" : "Until date"}
          </button>
        ))}
      </div>

      {mode === "duration" && (
        <div className="mt-2 flex gap-2">
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
            className="h-9 border border-dotted border-ink-40 bg-ground px-2 font-mono text-[0.8125rem] text-ink-90 outline-none focus-visible:border-solid focus-visible:border-ink-100"
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
          aria-label="Expires on"
          value={untilDate}
          onChange={(event) => setUntilDate(event.target.value)}
          className="mt-2"
          required
        />
      )}

      {/*
        States what the chosen option actually resolves to. "5 years" and
        "Forever" are the two settings most likely to be picked without
        thinking, on a product whose entire thesis is the leash.
      */}
      <p
        aria-live="polite"
        className="mt-2 border-t border-dotted border-ink-20 pt-2 text-[0.6875rem] text-ink-60"
      >
        {resolvedLabel === null ? (
          <>
            <span className="text-ink-90">This link never expires.</span> It
            stays live until you revoke it.
          </>
        ) : (
          <>
            Stops working <span className="text-ink-90">{resolvedLabel}</span>
          </>
        )}
      </p>
    </fieldset>
  );
}
