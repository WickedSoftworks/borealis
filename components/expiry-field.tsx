"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  EXPIRY_PRESETS,
  type ExpiryInput,
  isExpired,
  resolveExpiry,
} from "@/lib/shares/expiry";

type ExpiryMode = "keep" | "preset" | "duration" | "until";

const CHIP_ACTIVE =
  "bg-ink-100 px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-ground";
const CHIP_IDLE =
  "border border-dotted border-ink-40 px-2.5 py-1 text-[0.625rem] uppercase tracking-[0.16em] text-ink-60 transition-colors hover:border-ink-80 hover:text-ink-90";

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
  legend = "Expires",
  current,
  onChange,
}: {
  legend?: string;
  /** Pass the link's existing expiry to offer "keep it as it is". */
  current?: { expiresAt: string | null };
  /** Must be referentially stable — a `useState` setter, or memoised. */
  onChange: (expiry: ExpiryInput | null) => void;
}) {
  const [mode, setMode] = useState<ExpiryMode>(current ? "keep" : "preset");
  const [preset, setPreset] = useState("1w");
  const [durationValue, setDurationValue] = useState("36");
  const [durationUnit, setDurationUnit] = useState<
    "minutes" | "hours" | "days" | "weeks"
  >("hours");
  const [untilDate, setUntilDate] = useState("");

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

    return { mode: "preset", preset: preset as never };
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
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-[0.6875rem] uppercase tracking-[0.22em] text-ink-60">
        {legend}
      </legend>

      <div className="flex flex-wrap gap-1">
        {current && (
          <button
            type="button"
            aria-pressed={mode === "keep"}
            onClick={() => setMode("keep")}
            className={mode === "keep" ? CHIP_ACTIVE : CHIP_IDLE}
          >
            Keep current
          </button>
        )}

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
        {keepingAnExpiredLink ? (
          <>
            <span className="text-ink-90">
              This link expired {resolvedLabel}.
            </span>{" "}
            Pick a new expiry to bring it back.
          </>
        ) : resolvedLabel === null ? (
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
