import type { CSSProperties } from "react";

/**
 * The key under the issue's swimlane, in the kit's StatusTimeline style: the
 * stage ramp, then only the marks this chart draws. Decorative, like the
 * kit's: the chart's summary, footnote and table view say the same in words.
 */
export function TimelineLegend({
  skips,
  events,
  hatch,
  cut,
  style,
}: {
  skips: boolean;
  events: boolean;
  hatch: boolean;
  cut: boolean;
  style?: CSSProperties;
}) {
  return (
    <ul aria-hidden className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-mid" style={style}>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-4 rounded-[2px] bg-[linear-gradient(90deg,var(--stage-backlog),var(--stage-done))]" />
        Stage, earlier to later
      </li>
      {events ? (
        <li className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
            <path d="M6 1 11 6 6 11 1 6Z" fill="var(--text-mid)" />
          </svg>
          Estimate set or changed
        </li>
      ) : null}
      {skips ? (
        <li className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
            <circle cx="6" cy="6" r="4" fill="var(--chart-surface)" stroke="var(--text-mid)" strokeWidth="1.5" />
          </svg>
          Skipped stage
        </li>
      ) : null}
      {hatch ? (
        <li className="inline-flex items-center gap-1.5">
          <span className="hatch inline-block size-2.5 rounded-[2px] border border-hatch-edge" />
          Not tracked in Jira
        </li>
      ) : null}
      {cut ? (
        <li className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
            <path d="M2.5 10.5 5 1.5M7 10.5 9.5 1.5" stroke="var(--text-low)" strokeWidth="1.25" fill="none" />
          </svg>
          Quiet stretch cut short
        </li>
      ) : null}
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-px bg-ink-mid" />
        Now
      </li>
    </ul>
  );
}
