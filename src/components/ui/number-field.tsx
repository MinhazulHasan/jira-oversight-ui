"use client";

import type { KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

/** A number as typed, read leniently: "1.5", " 1.5 ", "1,5" (a decimal comma); null for anything else, or nothing. */
export function readNumber(text: string): number | null {
  const trimmed = text.trim().replace(/^(-?\d*),(\d+)$/, "$1.$2");
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** The decimal places a step moves in: 0.05 has two, 0.5 one, 1 none. */
function stepDecimals(step: number): number {
  const text = String(step);
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
}

/**
 * One step from `value` towards `direction` (-1 or 1, `steps` at a time), on
 * the grid the step makes from `min`, as a native number field steps: a value
 * between two marks goes to the next mark, never past the bounds.
 */
export function stepValue(value: number | null, direction: -1 | 1, steps: number, bounds: { min: number; max: number; step: number }): number {
  const { min, max, step } = bounds;
  const decimals = Math.max(stepDecimals(step), stepDecimals(min));
  const fixed = (number: number) => Number(number.toFixed(decimals));
  if (value === null) return fixed(direction > 0 ? min : max);
  const marks = Math.round(((value - min) / step) * 1e9) / 1e9;
  const next = direction > 0 ? Math.floor(marks) + steps : Math.ceil(marks) - steps;
  return fixed(Math.min(max, Math.max(min, min + next * step)));
}

export interface NumberFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  min: number;
  max: number;
  step: number;
  /** Drawn before the figure inside the field ("p" for a percentile); the accessible name says it in words. */
  prefix?: string;
  /** Drawn after the figure ("×", "h", "%", "days"). */
  suffix?: string;
  /** The ids of the elements that name it (the rule and the threshold), else `label`. */
  labelledBy?: string;
  label?: string;
  /** The ids of its hint and its message. */
  describedBy?: string;
  /** What the value means, read out with it ("1.5 times the estimate"). */
  valueText?: string;
  invalid?: boolean;
  id?: string;
  /** The figure's width: room for its longest value. */
  width?: string;
  className?: string;
}

/**
 * A number with its bounds, for a threshold: a spin button a reader types
 * into, or steps with the arrow keys (Shift for ten steps, Page Up and Down
 * too; Home and End for the bounds), as a native number field does, but drawn
 * the kit's way in every browser (no spinners, Plex Mono, its unit inside the
 * field) and read leniently (a decimal comma counts). It holds the text as
 * typed: what is wrong with it is the page's to say, beside it.
 */
export function NumberField({
  value,
  onValueChange,
  onBlur,
  min,
  max,
  step,
  prefix,
  suffix,
  labelledBy,
  label,
  describedBy,
  valueText,
  invalid = false,
  id,
  width = "3.5rem",
  className,
}: NumberFieldProps) {
  const number = readNumber(value);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const bounds = { min, max, step };
    let next: number | null = null;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      next = stepValue(number, event.key === "ArrowUp" ? 1 : -1, event.shiftKey ? 10 : 1, bounds);
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      next = stepValue(number, event.key === "PageUp" ? 1 : -1, 10, bounds);
    } else if (event.key === "Home") {
      next = min;
    } else if (event.key === "End") {
      next = max;
    }
    if (next === null) return;
    event.preventDefault();
    onValueChange(String(next));
  };

  return (
    <span className={cn("jo-number", className)} data-invalid={invalid || undefined}>
      {prefix ? (
        <span aria-hidden className="mono text-ink-low">
          {prefix}
        </span>
      ) : null}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        autoComplete="off"
        spellCheck={false}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={number ?? undefined}
        aria-valuetext={number === null ? undefined : valueText}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        // A figure after its prefix reads as one ("p90"); one before its unit sits against it ("1.5 ×").
        className={cn("mono", prefix ? "text-left" : undefined)}
        style={{ width }}
      />
      {suffix ? (
        <span aria-hidden className="text-ink-low">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}
