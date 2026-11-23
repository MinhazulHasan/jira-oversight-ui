"use client";

import { Meter } from "@/components/charts/meter";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Overview } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

import { COVERAGE_KEYS, COVERAGE_LABEL, coverageReason, isCountable, type CoverageKey } from "./copy";
import { BASELINE_HREF, ESTIMATE_FINDINGS_HREF } from "./links";

/** Where a share leads: the work that started unestimated, or the baseline's fuller breakdown. */
const HREF: Partial<Record<CoverageKey, string>> = {
  estimate: ESTIMATE_FINDINGS_HREF,
  story_points: BASELINE_HREF,
  time_logged: BASELINE_HREF,
};

/*
 * What can be counted shares one row; what Jira cannot show takes a wider
 * row under it, so "Not measurable" and its reason never crowd the label.
 */
const GRID = "grid grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-6";
const COUNTABLE_CELL = "md:col-span-2";
const GAP_CELL = "col-span-2 md:col-span-3";
const SCOPE = "Work created in the last 90 days, Epics left out";

/** A meter's shape while loading: the label and share, the track, then the line under it. */
function MeterSkeleton({ className }: { className: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <span className="flex h-6 items-center justify-between gap-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3.5 w-9" />
      </span>
      <Skeleton className="h-1.5 w-full rounded-pill" />
      <Skeleton className="my-[3px] h-3 w-24" />
    </div>
  );
}

/**
 * How much of the work carries what the process needs: estimates, points and
 * logged time as shares, and the steps Jira holds no evidence for, hatched,
 * with the reason. That gap is a finding for James, so it reads calmly.
 */
export function Coverage({ data, className }: { data?: Overview; className?: string }) {
  const locale = useFigureLocale();
  const entries = data ? COVERAGE_KEYS.map((key) => ({ key, entry: data.coverage[key] })) : [];
  const totals = new Set(entries.map(({ entry }) => entry.total));
  const total = totals.size === 1 ? [...totals][0] : null;
  const description = total === null ? `${SCOPE}.` : `${SCOPE}: ${formatCount(total, { locale })} issues.`;

  return (
    <Section id="coverage" title="Coverage" description={description} className={className}>
      {!data ? (
        <SkeletonGroup label="Loading the coverage" className={GRID}>
          {/* Today's shape: three countable entries, then code review and test evidence, which Jira cannot show. */}
          {COVERAGE_KEYS.map((key, index) => (
            <MeterSkeleton key={key} className={index >= 3 ? GAP_CELL : COUNTABLE_CELL} />
          ))}
        </SkeletonGroup>
      ) : total === 0 ? (
        <EmptyState size="compact" title="No work created in the last 90 days" />
      ) : (
        <div className={GRID}>
          {entries.map(({ key, entry }) =>
            isCountable(entry) ? (
              <Meter
                key={key}
                label={COVERAGE_LABEL[key]}
                value={entry.covered}
                total={entry.total}
                href={HREF[key]}
                className={COUNTABLE_CELL}
              />
            ) : (
              <Meter
                key={key}
                label={COVERAGE_LABEL[key]}
                value={0}
                total={entry.total}
                measurable={false}
                reason={coverageReason(entry)}
                className={GAP_CELL}
              />
            ),
          )}
        </div>
      )}
    </Section>
  );
}
