"use client";

import { RotateCcw } from "lucide-react";
import { useMemo, useRef } from "react";

import { ChartFrame } from "@/components/charts/chart-frame";
import { useElementWidth } from "@/components/charts/use-element-width";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import { formatCount } from "@/lib/format";

import { IssueTimelineChart } from "./issue-timeline-chart";
import { ms, type IssueData, type ProcessMap } from "./model";
import { buildTimeline, timelineSpan, timelineSummary, timelineTable } from "./timeline-model";
import { quietStretch } from "./timeline-scale";

const AXIS_H = 26;
const LEGEND_H = 34;

export interface IssueTimelineProps {
  /** null while the issue loads. */
  data: IssueData | null;
  /** The process map (lanes, and which stages Jira records); null while loading or when it failed. */
  process: ProcessMap | null;
  processState: "loading" | "ready" | "error";
  onRetryProcess?: () => void;
  retryingProcess?: boolean;
}

export function IssueTimeline({ data, process, processState, onRetryProcess, retryingProcess }: IssueTimelineProps) {
  const locale = useFigureLocale();
  const box = useRef<HTMLDivElement>(null);
  const width = useElementWidth(box);
  const narrow = width > 0 && width < 640;
  // 30 px lanes keep all nine on a MacBook's first screen, under the header and the facts.
  const laneHeight = narrow ? 26 : 30;

  const model = useMemo(() => (data ? buildTimeline(data, process) : null), [data, process]);
  const lanes = model?.lanes.length ?? process?.stages.length ?? 9;
  const height = AXIS_H + lanes * laneHeight + LEGEND_H;
  const waiting = !data || !model || processState === "loading";

  if (waiting) {
    return (
      <Section title="Status timeline" id="timeline">
        <div ref={box}>
          <ChartFrame title="Status by stage" summary="The status timeline is loading." state="loading" height={height}>
            {null}
          </ChartFrame>
        </div>
      </Section>
    );
  }

  const key = data.issue.key;
  const clock = ms(data.meta.last_synced_at);
  const finished = data.issue.status_category === "done";
  const span = timelineSpan(model, clock);
  const quiet = finished ? quietStretch(span.start, span.lastEvent, clock) : null;

  return (
    <Section title="Status timeline" id="timeline">
      <div ref={box}>
        <ChartFrame
          title="Status by stage"
          description={
            <>
              From creation on <Timestamp value={data.issue.created_at} /> to now, in your time zone
            </>
          }
          summary={timelineSummary(key, model, clock, locale)}
          table={timelineTable(model, clock, locale)}
          state={model.spells.length === 0 ? "empty" : "ready"}
          emptyTitle={`No status history for ${key}`}
          emptyDescription="No status history."
          height={height}
          footnote={
            quiet || processState === "error" ? (
              <span className="flex flex-col gap-1">
                {quiet ? (
                  <span data-testid="timeline-cut">
                    Axis shortened after <Timestamp value={new Date(quiet.from).toISOString()} />: the{" "}
                    <span className="mono">{formatCount(quiet.days, { locale })}</span> {quiet.days === 1 ? "day" : "days"}{" "}
                    since had no changes.
                  </span>
                ) : null}
                {processState === "error" ? (
                  <span className="inline-flex flex-wrap items-center gap-x-2">
                    The process map did not load.
                    {onRetryProcess ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={RotateCcw}
                        loading={retryingProcess}
                        onClick={onRetryProcess}
                        className="-my-1"
                      >
                        Try again
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </span>
            ) : undefined
          }
        >
          <IssueTimelineChart
            title={`${key}, status timeline`}
            lanes={model.lanes}
            spells={model.spells}
            skips={model.skips}
            events={model.events}
            now={data.meta.last_synced_at}
            cutQuietTail={finished}
            laneHeight={laneHeight}
            labelWidth={narrow ? 104 : 148}
            compact={narrow}
          />
        </ChartFrame>
      </div>
    </Section>
  );
}
