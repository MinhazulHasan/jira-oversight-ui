"use client";

import Link from "next/link";
import { useId } from "react";

import { useFigureLocale } from "@/components/ui/use-figures";
import { formatCount, formatShare } from "@/lib/format";
import { cn } from "@/lib/utils";

import { SERIES_COLOURS, STATUS_COLOURS } from "./palette";

export type MeterTone = "neutral" | "resolved" | "warning" | "breach";

const FILL: Record<MeterTone, string> = {
  neutral: SERIES_COLOURS[0],
  resolved: STATUS_COLOURS.resolved,
  warning: STATUS_COLOURS.warning,
  breach: STATUS_COLOURS.breach,
};

// The unfilled track is a light step of the fill's own hue, so the state reads across the whole bar.
const TRACK: Record<MeterTone, string> = {
  neutral: "var(--chart-track)",
  resolved: "var(--ok-tint)",
  warning: "var(--warn-tint)",
  breach: "var(--breach-tint)",
};

export interface MeterProps {
  /** What is covered: "Estimates", "Time logged". */
  label: string;
  /** How many have it. */
  value: number;
  /** Out of how many. */
  total: number;
  /** What the total counts, for "192 of 291 issues". */
  noun?: string;
  /**
   * Colour by what the share means. Neutral unless a rule judges it: a
   * coverage below its agreed floor can be warning.
   */
  tone?: MeterTone;
  /** A target share (0 to 1), drawn as a tick on the track. */
  target?: number;
  /**
   * False when Jira holds no evidence for this at all: the track is hatched
   * and the figure says "Not measurable". That gap is a finding for the
   * reader, so it reads calmly, not as an error.
   */
  measurable?: boolean;
  /** Why it is not measurable: "No review status in the workflow". */
  reason?: string;
  /** Click through to the rows behind the figure. */
  href?: string;
  className?: string;
}

/**
 * One share against the whole: coverage of estimates, of logged time, of
 * process evidence. The share leads, n of N follows, and the bar fills a
 * light track of its own hue.
 */
export function Meter({
  label,
  value,
  total,
  noun = "issues",
  tone = "neutral",
  target,
  measurable = true,
  reason,
  href,
  className,
}: MeterProps) {
  const locale = useFigureLocale();
  const labelId = useId();
  const share = total > 0 ? value / total : 0;
  const shareText = formatShare(share, { locale });
  const countText = `${formatCount(value, { locale })} of ${formatCount(total, { locale })} ${noun}`;

  const heading = (
    <span className="flex items-baseline justify-between gap-3">
      <span id={labelId} className="truncate text-sm text-ink-mid">
        {label}
      </span>
      {measurable ? (
        <span className="mono shrink-0 text-md font-medium text-ink" data-figure>
          {shareText}
        </span>
      ) : (
        <span className="shrink-0 text-sm font-medium text-ink-low">Not measurable</span>
      )}
    </span>
  );

  const bar = measurable ? (
    <span
      role="meter"
      aria-labelledby={labelId}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(value, total)}
      aria-valuetext={`${shareText}, ${countText}`}
      className="relative block h-1.5 w-full overflow-hidden rounded-pill"
      style={{ background: TRACK[tone] }}
    >
      <span
        className="jo-meter-fill absolute inset-y-0 left-0 rounded-pill"
        style={{ width: `${Math.min(1, Math.max(0, share)) * 100}%`, background: FILL[tone] }}
      />
      {target !== undefined ? (
        <span
          aria-hidden
          className="absolute -inset-y-px w-[2px] -translate-x-1/2 bg-ink-mid"
          style={{ left: `${Math.min(1, Math.max(0, target)) * 100}%` }}
        />
      ) : null}
    </span>
  ) : (
    <span aria-hidden className="hatch block h-1.5 w-full rounded-pill border border-hatch-edge/60" />
  );

  const foot = (
    <span className="text-xs text-ink-low">
      {measurable ? (
        <>
          <span className="mono" data-figure>
            {formatCount(value, { locale })}
          </span>{" "}
          of{" "}
          <span className="mono" data-figure>
            {formatCount(total, { locale })}
          </span>{" "}
          {noun}
          {target !== undefined ? <> · target {formatShare(target, { locale })}</> : null}
        </>
      ) : (
        (reason ?? "Jira holds no evidence for this step.")
      )}
    </span>
  );

  const body = (
    <>
      {heading}
      {bar}
      {foot}
    </>
  );

  const frame = cn("flex min-w-0 flex-col gap-2", className);
  if (href && measurable) {
    return (
      <Link href={href} className={cn(frame, "pressable -m-2 rounded-md p-2 outline-offset-[-2px] hover:bg-rail")}>
        {body}
      </Link>
    );
  }
  return <div className={frame}>{body}</div>;
}
