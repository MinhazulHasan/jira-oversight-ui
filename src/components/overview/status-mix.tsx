"use client";

import { TooltipBody } from "@/components/charts/chart-tooltip";
import { OTHER_COLOUR, STAGE_LABELS, STAGES, stageColour } from "@/components/charts/palette";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Overview } from "@/lib/api/schemas";
import { formatCount, formatShare } from "@/lib/format";
import { cn } from "@/lib/utils";

export type StatusCount = Overview["status_mix"][number];

const CATEGORY_ORDER: Record<StatusCount["status_category"], number> = { new: 0, indeterminate: 1, done: 2 };

function stageIndex(stage: StatusCount["stage"]): number {
  return stage === null ? STAGES.length : STAGES.indexOf(stage);
}

/** Not started, then in progress, then done; within each, James's stage order. */
export function orderStatuses(mix: readonly StatusCount[]): StatusCount[] {
  return mix
    .map((status, index) => ({ status, index }))
    .sort(
      (a, b) =>
        CATEGORY_ORDER[a.status.status_category] - CATEGORY_ORDER[b.status.status_category] ||
        stageIndex(a.status.stage) - stageIndex(b.status.stage) ||
        a.index - b.index,
    )
    .map(({ status }) => status);
}

/** A status takes its stage's step on the ordinal ramp; an unmapped one is context grey. */
function colourOf(status: StatusCount): string {
  return status.stage ? stageColour(status.stage) : OTHER_COLOUR;
}

/** "68 of 1,136 issues are open: 39 not started, 29 in progress." */
export function openSentence(mix: readonly StatusCount[], locale: string | undefined): string {
  const total = mix.reduce((sum, status) => sum + status.count, 0);
  const notStarted = mix.filter((status) => status.status_category === "new").reduce((sum, status) => sum + status.count, 0);
  const inProgress = mix.filter((status) => status.status_category === "indeterminate").reduce((sum, status) => sum + status.count, 0);
  const open = notStarted + inProgress;
  const read = (value: number) => formatCount(value, { locale });
  if (open === 0) return `All ${read(total)} issues are done.`;
  const parts = [
    notStarted > 0 ? `${read(notStarted)} not started` : null,
    inProgress > 0 ? `${read(inProgress)} in progress` : null,
  ].filter((part): part is string => part !== null);
  return `${read(open)} of ${read(total)} ${total === 1 ? "issue is" : "issues are"} open: ${parts.join(", ")}.`;
}

/*
 * A status, its stage, its count and its share on one line where the list has room (from 28rem); in a narrower list
 * (a phone) the stage goes under the status, so neither is cut short, and a long status wraps (JO-14).
 */
const LIST_ROW = cn(
  "grid items-center gap-x-3 gap-y-0.5 grid-cols-[0.625rem_minmax(0,1fr)_4.5rem_3rem] [grid-template-areas:'key_status_count_share'_'._stage_._.']",
  "@min-[28rem]:min-h-6 @min-[28rem]:gap-y-0 @min-[28rem]:grid-cols-[0.625rem_minmax(0,1fr)_minmax(0,1fr)_4.5rem_3rem] @min-[28rem]:[grid-template-areas:'key_status_stage_count_share']",
);

/**
 * Where the work is right now: one thin bar of the issues by current status,
 * coloured by the stage of James's process each status maps to, and the same
 * counts listed under it. The bar is a picture of the list; the list is what
 * assistive technology reads.
 */
export function StatusMix({ data, className }: { data?: Overview; className?: string }) {
  const locale = useFigureLocale();
  const statuses = data ? orderStatuses(data.status_mix).filter((status) => status.count > 0) : [];
  const total = statuses.reduce((sum, status) => sum + status.count, 0);

  return (
    <Section id="status-mix" title="Where work sits now" description="Issues by status, Epics left out." className={className}>
      {!data ? (
        <SkeletonGroup label="Loading where work sits now" className="flex flex-col gap-3">
          <Skeleton className="my-[3px] h-3 w-64 max-w-full" />
          <Skeleton className="h-2 w-full rounded-pill" />
          <div className="@container flex flex-col gap-1.5 pt-1">
            {["w-16", "w-24", "w-14"].map((width) => (
              <div key={width} className={LIST_ROW}>
                <Skeleton className="size-2.5 [grid-area:key]" />
                <span className="flex h-5 items-center [grid-area:status]">
                  <Skeleton className={cn("h-3", width)} />
                </span>
                <span className="flex h-4 items-center [grid-area:stage] @min-[28rem]:h-5">
                  <Skeleton className="h-3 w-20" />
                </span>
                <Skeleton className="ml-auto h-3 w-10 [grid-area:count]" />
                <Skeleton className="ml-auto h-3 w-7 [grid-area:share]" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      ) : total === 0 ? (
        <EmptyState
          size="compact"
          title="No work in scope"
          description={"No issues besides Epics."}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-mid">{openSentence(statuses, locale)}</p>

          <div aria-hidden className="flex h-2 w-full gap-[2px] overflow-hidden rounded-pill">
            {statuses.map((status) => (
              <Tooltip
                key={status.status}
                content={
                  <TooltipBody
                    heading={status.status}
                    rows={[
                      { id: "count", value: formatCount(status.count, { locale }), name: "issues", colour: colourOf(status), key: "block" },
                      { id: "share", value: formatShare(status.count / total, { locale }), name: "of the work" },
                    ]}
                  />
                }
                side="top"
                delayDuration={0}
                className="bg-transparent p-0 shadow-none"
              >
                <span
                  className="jo-segment h-full min-w-[3px]"
                  style={{ flexGrow: status.count, flexBasis: 0, background: colourOf(status) }}
                />
              </Tooltip>
            ))}
          </div>

          <ul aria-label="Issues by status" className="@container flex flex-col gap-1.5 pt-1">
            {statuses.map((status) => (
              <li key={status.status} className={cn(LIST_ROW, "text-sm")}>
                <span aria-hidden className="jo-key-block [grid-area:key]" style={{ background: colourOf(status) }} />
                <span className="text-balance text-ink [grid-area:status]">{status.status}</span>
                <span className="text-xs text-balance text-ink-low [grid-area:stage]">
                  {status.stage ? `${STAGE_LABELS[status.stage]} stage` : "Not mapped to a stage"}
                </span>
                <span className="mono text-right text-ink [grid-area:count]" data-figure>
                  {formatCount(status.count, { locale })}
                </span>
                <span className="mono text-right text-ink-low [grid-area:share]" data-figure>
                  {formatShare(status.count / total, { locale })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
