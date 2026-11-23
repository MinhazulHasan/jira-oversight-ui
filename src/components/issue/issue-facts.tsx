"use client";

import type { ReactNode } from "react";

import { StatTile } from "@/components/ui/stat-tile";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Finding } from "@/lib/api/schemas";
import { formatByKind, formatCount, formatHours, formatNumber, formatRatio } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  effortVerdict,
  estimateHours,
  estimateTiming,
  findingForFact,
  findingHref,
  reopenChanges,
  type IssueData,
} from "./model";

/* The tiles sit in one hairline frame: six across on a laptop, three on a tablet, two on a phone. */
const GRID =
  "grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule-weak bg-rule-weak @2xl:grid-cols-3 @5xl:grid-cols-6";
const LABELS = ["Story points", "Time logged", "Effort ratio", "Cycle time", "Reopens", "Estimate set"];

const points = (value: number, options?: { locale?: string }) => formatByKind(value, "points", options);

/** Lines under a tile's figure; the first can carry the verdict in its status ink. */
function Lines({ lines, tone }: { lines: ReactNode[]; tone?: Finding["severity"] }) {
  return (
    <>
      {lines.map((line, index) => (
        <span
          key={index}
          className={cn("block", index === 0 && tone === "breach" && "text-breach-ink", index === 0 && tone === "warning" && "text-warn-ink")}
        >
          {line}
        </span>
      ))}
    </>
  );
}

/** A tile a rule has fired on wears the finding's mark and opens it. */
function linked(finding: Finding | null) {
  return finding
    ? { mark: finding.severity, href: findingHref(finding.finding_id), hrefLabel: `Open the finding: ${finding.rule_title}` }
    : {};
}

/** The issue's facts: estimate, time logged, effort against its threshold, cycle time, reopens, when the estimate was set. */
export function IssueFacts({ data, hoursPerPoint }: { data: IssueData; hoursPerPoint: number | null }) {
  const locale = useFigureLocale();
  const { issue, findings } = data;
  const hours = (value: number) => formatHours(value, { locale });

  const estimate = findingForFact(findings, "estimate");
  const estimated = estimateHours(issue, hoursPerPoint);
  const effort = findingForFact(findings, "effort");
  const verdict = effortVerdict(issue.effort_ratio, issue.effort_threshold);
  const effortMark = effort?.severity ?? (verdict === "over" || verdict === "at" ? "breach" : undefined);
  const reopen = findingForFact(findings, "reopens");
  const lastReopen = reopenChanges(data).at(-1);
  const timing = estimateTiming(issue);
  const late = findingForFact(findings, "estimateSet");
  const weeks = data.worklogs.filter((week) => week.hours > 0).length;

  const estimateTile =
    issue.estimate_basis === "points" ? (
      <StatTile
        label="Story points"
        value={issue.story_points}
        format={points}
        footnote={
          issue.story_points === null
            ? "No points set"
            : estimated === null
              ? "Not converted to hours"
              : hoursPerPoint
                ? `${hours(estimated)} at ${formatNumber(hoursPerPoint, { locale })} h a point`
                : `${hours(estimated)} estimated`
        }
        {...linked(estimate)}
      />
    ) : issue.estimate_basis === "hours" ? (
      <StatTile
        label="Original estimate"
        value={estimated}
        format={formatHours}
        footnote={estimated === null ? "Set in hours" : "Set in hours, in Jira"}
        {...linked(estimate)}
      />
    ) : (
      <StatTile
        label="Estimate"
        value={null}
        footnote={<Lines lines={["None in Jira", estimate ? estimate.rule_title : "No points or original estimate"]} tone={estimate?.severity} />}
        {...linked(estimate)}
      />
    );

  return (
    <section aria-label="Facts" className="@container">
      <div className={GRID}>
        {estimateTile}

        <StatTile
          label="Time logged"
          value={issue.time_spent_h}
          format={formatHours}
          footnote={weeks > 0 ? `In ${formatCount(weeks, { locale })} ${weeks === 1 ? "week" : "weeks"}` : "Nothing logged"}
        />

        <StatTile
          label="Effort ratio"
          value={issue.effort_ratio}
          format={formatRatio}
          mark={effortMark}
          href={effort ? findingHref(effort.finding_id) : undefined}
          hrefLabel={effort ? `Open the finding: ${effort.rule_title}` : undefined}
          footnote={
            verdict === null ? (
              "No estimate to measure against"
            ) : (
              <Lines
                tone={effortMark === "breach" || effortMark === "warning" ? effortMark : undefined}
                lines={[
                  `${verdict === "over" ? "Over" : verdict === "at" ? "At" : "Under"} the ${formatRatio(issue.effort_threshold, { locale })} threshold`,
                  ...(issue.time_spent_h !== null && estimated !== null ? [`${hours(issue.time_spent_h)} ÷ ${hours(estimated)}`] : []),
                ]}
              />
            )
          }
        />

        <StatTile
          label="Cycle time"
          value={issue.cycle_time_h}
          format={formatHours}
          footnote={
            issue.cycle_time_h !== null ? (
              <Lines
                lines={[
                  `${formatNumber(issue.cycle_time_h / 24, { locale, decimals: 1 })} days to Done`,
                  ...(issue.started_at ? [<>Work began <Timestamp value={issue.started_at} /></>] : []),
                ]}
              />
            ) : issue.started_at ? (
              <Lines lines={["Not done yet", <>Work began <Timestamp value={issue.started_at} /></>]} />
            ) : issue.resolved_at ? (
              "Done without development"
            ) : (
              "Not started"
            )
          }
        />

        <StatTile
          label="Reopens"
          value={issue.reopen_count}
          format={formatCount}
          footnote={
            issue.reopen_count > 0 && lastReopen ? (
              <Lines
                tone={reopen?.severity}
                lines={[`${lastReopen.from} → ${lastReopen.to}`, <>On <Timestamp value={lastReopen.changed_at} /></>]}
              />
            ) : issue.reopen_count > 0 ? (
              "Moved out of Done"
            ) : issue.status_category === "done" ? (
              "Never reopened"
            ) : (
              "Not reopened"
            )
          }
          {...linked(reopen)}
        />

        <StatTile
          label="Estimate set"
          value={timing.kind === "before" || timing.kind === "at" || timing.kind === "after" ? timing.hours : null}
          format={formatHours}
          footnote={
            timing.kind === "none" ? (
              "No estimate set"
            ) : timing.kind === "unstarted" ? (
              <Lines lines={["Work not started", <>Set <Timestamp value={timing.setAt} /></>]} />
            ) : (
              // When work began is the Cycle time tile's second line, beside it.
              <Lines
                tone={late?.severity}
                lines={[
                  timing.kind === "after" ? "After work began" : timing.kind === "before" ? "Before work began" : "As work began",
                  <>Set <Timestamp value={timing.setAt} /></>,
                ]}
              />
            )
          }
          {...linked(late)}
        />
      </div>
    </section>
  );
}

/** The facts while they load: the same six tiles, waiting. */
export function IssueFactsLoading() {
  return (
    <section aria-label="Facts" aria-busy="true" className="@container">
      <div className={GRID}>
        {LABELS.map((label) => (
          <StatTile key={label} label={label} value={null} state="loading" />
        ))}
      </div>
    </section>
  );
}
