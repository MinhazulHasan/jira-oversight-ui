"use client";

import { KeyValueList, type KeyValueItem } from "@/components/ui/key-value";
import { Section } from "@/components/ui/section";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { StatTile, StatTileGrid } from "@/components/ui/stat-tile";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Baseline } from "@/lib/api/schemas";
import { formatCount, formatHours, formatShare } from "@/lib/format";

type Worklogs = Baseline["figures"]["worklogs"];

function worklogFacts(worklogs: Worklogs, locale?: string): KeyValueItem[] {
  return [
    { id: "entries", label: "Worklog entries", value: formatCount(worklogs.count, { locale }), mono: true },
    { id: "hours", label: "Hours logged", value: formatHours(worklogs.total_hours, { locale }), mono: true },
    { id: "people", label: "People who logged time", value: formatCount(worklogs.authors, { locale }), mono: true },
  ];
}

function FactsSkeleton({ rows }: { rows: number }) {
  return (
    <SkeletonGroup label="Loading the worklog totals">
      <div className="flex flex-col overflow-hidden rounded-sm border border-rule-weak">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex min-h-8 items-center justify-between gap-3 border-t border-rule-weak px-3 py-1 first:border-t-0">
            <Skeleton className="h-2.5 w-32" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

export function FlowBlock({ data }: { data: Baseline | undefined }) {
  const locale = useFigureLocale();
  const figures = data?.figures;
  const state = figures ? "ready" : "loading";
  const cycle = figures?.cycle_time;

  return (
    <Section
      id="flow"
      title="Cycle time, reopens and worklogs"
      description="Cycle time runs from first development to Done. A reopen left Done again."
    >
      <div className="grid gap-6 xl:grid-cols-2 xl:gap-12">
        <StatTileGrid columns={2} label="Cycle time and reopens" className="self-start">
          <StatTile
            label="Cycle time"
            value={cycle?.median ?? null}
            format={formatHours}
            state={state}
            footnote={
              cycle
                ? `Median of ${formatCount(cycle.n, { locale })} · p75 ${formatHours(cycle.p75, { locale })} · p90 ${formatHours(cycle.p90, { locale })}`
                : undefined
            }
          />
          <StatTile
            label="Reopened after Done"
            value={figures?.reopens.count ?? null}
            state={state}
            footnote={figures ? `${formatShare(figures.reopens.share, { locale })} of resolved work` : undefined}
          />
        </StatTileGrid>

        {figures ? (
          <KeyValueList items={worklogFacts(figures.worklogs, locale)} labelWidth="minmax(0,52%)" />
        ) : (
          <FactsSkeleton rows={3} />
        )}
      </div>
    </Section>
  );
}
