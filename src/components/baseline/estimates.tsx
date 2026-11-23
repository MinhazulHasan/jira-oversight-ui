"use client";

import { Meter } from "@/components/charts/meter";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { StatTile, StatTileGrid } from "@/components/ui/stat-tile";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Baseline } from "@/lib/api/schemas";
import { formatCount, formatHours } from "@/lib/format";

import { MetersSkeleton } from "./coverage";

/**
 * How many hours a story point turned out to cost on resolved work: the
 * median and the middle half, then how often work landed near the agreed
 * rate and how often the estimate came after the work had started.
 */
export function EstimatesBlock({ data }: { data: Baseline | undefined }) {
  const locale = useFigureLocale();
  const estimates = data?.figures.estimates;
  const spread = estimates?.hours_per_point;
  const state = spread ? "ready" : "loading";

  return (
    <Section
      id="estimates"
      title="Hours per story point"
      count={spread ? formatCount(spread.n, { locale }) : undefined}
      description={
        spread
          ? `Logged hours per story point, ${formatCount(spread.n, { locale })} resolved issues.`
          : "Logged hours per story point on resolved work."
      }
    >
      {estimates && spread && spread.n === 0 ? (
        <EmptyState
          size="compact"
          title="No resolved work has both story points and logged time"
          description="No resolved issue has both an estimate and logged time."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <StatTileGrid columns={3} label="The spread of hours per story point">
            <StatTile label="25th percentile" value={spread?.p25 ?? null} format={formatHours} state={state} />
            <StatTile label="Median" value={spread?.median ?? null} format={formatHours} state={state} />
            <StatTile label="75th percentile" value={spread?.p75 ?? null} format={formatHours} state={state} />
          </StatTileGrid>

          {estimates && spread ? (
            <div className="flex flex-col gap-5">
              {estimates.within_25pct ? (
                <div id="fig-within-25pct">
                  <Meter
                    label={`Within 25% of ${formatHours(estimates.within_25pct.hours_per_point, { locale })} per point`}
                    value={estimates.within_25pct.count}
                    total={spread.n}
                  />
                </div>
              ) : null}
              <div id="fig-estimate-after-start">
                <Meter
                  label="Estimate set after work started"
                  value={estimates.estimate_set_after_start.count}
                  total={estimates.estimate_set_after_start.of}
                  noun="estimated issues"
                />
              </div>
            </div>
          ) : (
            <MetersSkeleton label="Loading how estimates compare with the work" count={2} />
          )}
        </div>
      )}
    </Section>
  );
}
